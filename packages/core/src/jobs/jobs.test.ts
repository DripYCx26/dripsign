import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "../db.ts";
import { canonicalJson } from "../schema.ts";
import { getStorage, hashBytes, objectKey, readBytes } from "../adapters/storage.ts";
import { completeArchive } from "../domain/signing.ts";
import { enqueue, finishJob, retryJob } from "./outbox.ts";
import * as outboxModule from "./outbox.ts";
import { createHandlers } from "./handlers.ts";
import { executeJob } from "./runner.ts";
import { parseConfig } from "../config.ts";
import { rescueArchives } from "./sweep.ts";
import {
  archiveFixture,
  assertModelPrice,
  assertRetention,
  claimOwnJobs,
  dueAgain,
  fixture,
  source,
} from "./testSupport.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeAll(() => {
  vi.stubEnv("DRIPSIGN_ANTHROPIC_API_KEY", "synthetic-not-a-provider-key");
  vi.stubEnv("DRIPSIGN_AI_DAILY_LIMIT_USD", "1");
});
afterAll(async () => {
  await closePool();
  vi.unstubAllEnvs();
});

describe("operator CLI", () => {
  const cli = (args: readonly string[], env: NodeJS.ProcessEnv) =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("../cli.ts", import.meta.url)), ...args],
      { encoding: "utf8", env },
    ).stderr.trim();

  it("refuses the demo seed in production and an unprintable organisation before any database", () => {
    const production = {
      NODE_ENV: "production",
      DRIPSIGN_DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1:1/synthetic_test",
      DRIPSIGN_PUBLIC_ORIGIN: "https://dripsign.example.test",
      DRIPSIGN_AUTH_SECRET: "synthetic-auth-secret-0123456789abcdef",
      DRIPSIGN_STORAGE: "s3",
      DRIPSIGN_S3_BUCKET: "synthetic-dripsign-fj",
      AWS_REGION: "us-east-1",
      DRIPSIGN_EMAIL_TRANSPORT: "ses",
      DRIPSIGN_EMAIL_FROM: "no-reply@example.test",
    };
    expect(cli(["seed"], production)).toBe("seed is refused in production.");
    const tenant = ["--tenant", "東京 Legal", "--email", "admin@example.test", "--role", "admin"];
    expect(cli(["add-staff", ...tenant], production)).toBe(
      "The organisation name has characters the PDF cannot print.",
    );
  });
});

describe("outbox execution", () => {
  it("archives through failures with fenced leases, rescue, capped backoff and confidential logs", async () => {
    const context = await archiveFixture();
    const jobs = await claimOwnJobs([context.jobId]);
    const stale = jobs.find((job) => job.id === context.jobId);
    if (!stale) throw new Error("Archive was not claimed");
    let current = await dueAgain(stale);
    expect(await finishJob(getPool(), stale)).toBe(false);
    const row = () => getPool().query("SELECT * FROM dripsign.outbox WHERE id=$1", [stale.id]);
    const before = await row();
    expect(
      await completeArchive(getPool(), {
        tenantId: context.tenantId,
        roundId: context.roundId,
        leaseFence: stale,
        signedDocument: context.document,
        auditRecord: context.document,
      }),
    ).toBe("lease_lost");
    expect((await row()).rows).toEqual(before.rows);
    await getPool().query("UPDATE dripsign.outbox SET attempts=1100 WHERE id=$1", [current.id]);
    expect(await retryJob(getPool(), current, "storage_unavailable")).toBe(true);
    const delay = await getPool().query<{ seconds: number }>(
      "SELECT extract(epoch FROM available_at - now())::float8 AS seconds FROM dripsign.outbox WHERE id=$1",
      [current.id],
    );
    expect(delay.rows[0]?.seconds).toBeGreaterThan(3590);
    expect(delay.rows[0]?.seconds).toBeLessThan(3601);
    await getPool().query(
      "UPDATE dripsign.outbox SET status='failed',finished_at=now(),lease_token=NULL WHERE id=$1",
      [current.id],
    );
    await rescueArchives();
    await rescueArchives();
    const rescued = await getPool().query<{ id: string }>(
      "SELECT id FROM dripsign.outbox WHERE kind='archive' AND tenant_id=$1 AND payload->>'roundId'=$2 AND status='pending'",
      [context.tenantId, context.roundId],
    );
    expect(rescued.rows).toHaveLength(1);
    const replacement = (await claimOwnJobs([rescued.rows[0]?.id ?? null])).find(
      (job) => job.id === rescued.rows[0]?.id,
    );
    if (!replacement) throw new Error("Rescued archive was not claimed");
    current = replacement;
    const storage = getStorage();
    let failures = 0;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handlers = createHandlers({
      get: (key) => storage.get(key),
      put: async (key, bytes) => {
        if (failures++ < 2)
          throw Object.assign(new Error("Private email signer@example.test and code 123456"), {
            code: "08006",
          });
        await storage.put(key, bytes);
      },
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      await executeJob(current, handlers);
      if (attempt < 2) {
        const state = await getPool().query<{ status: string; last_error: string }>(
          "SELECT status,last_error FROM dripsign.outbox WHERE id=$1",
          [current.id],
        );
        expect(state.rows[0]?.status).toBe("pending");
        expect(state.rows[0]?.last_error).toBe("08006");
        current = await dueAgain(current);
      }
    }
    expect(log.mock.calls).toEqual([
      ["dripsign: job failed", { id: current.id, code: "08006" }],
      ["dripsign: job failed", { id: current.id, code: "08006" }],
    ]);
    const agreement = await getPool().query<{ status: string }>(
      "SELECT status FROM dripsign.agreement WHERE tenant_id=$1 AND id=$2",
      [context.tenantId, context.agreementId],
    );
    expect(agreement.rows[0]?.status).toBe("signed");
    const artifacts = await getPool().query<{ sha256: string; byte_length: number }>(
      "SELECT sha256,byte_length FROM dripsign.artifact WHERE tenant_id=$1 AND round_id=$2",
      [context.tenantId, context.roundId],
    );
    expect(artifacts.rows).toHaveLength(2);
    for (const artifact of artifacts.rows) {
      const bytes = await readBytes({
        key: objectKey(context.tenantId, artifact.sha256),
        sha256: artifact.sha256,
        byteLength: artifact.byte_length,
      });
      expect(hashBytes(bytes)).toBe(artifact.sha256);
      expect(artifact.sha256).not.toBe(context.document.sha256);
    }
  });

  it("fences claims and AI spend, classifies retries, renews leases, prices the model and batches retention", async () => {
    const concurrency = parseConfig({
      ...process.env,
      DRIPSIGN_JOBS_CONCURRENCY: "8",
    }).jobsConcurrency;
    expect(concurrency).toBe(8);
    expect(concurrency).toBeLessThanOrEqual(getPool().options.max - 2);
    expect(() => parseConfig({ ...process.env, DRIPSIGN_JOBS_CONCURRENCY: "9" })).toThrow(
      /DRIPSIGN_JOBS_CONCURRENCY/u,
    );
    const context = await fixture();
    const foreignId = await enqueue(getPool(), {
      tenantId: null,
      agreementId: null,
      dedupeKey: null,
      availableAt: new Date(0),
      payload: { kind: "email", template: "otp_code", to: "foreign@example.test", params: {} },
    });
    const foreignRow = () =>
      getPool().query("SELECT * FROM dripsign.outbox WHERE id=$1", [foreignId]);
    const foreignBefore = await foreignRow();
    const suggestionId = randomUUID();
    await getPool().query(
      `INSERT INTO dripsign.ai_suggestion (tenant_id,agreement_id,id,requested_by,instruction,mode,base_source,base_source_sha256,model,reserved_micros)
      VALUES ($1,$2,$3,$4,'Review scope','draft',$5,$6,'claude-sonnet-5-5',2000000)`,
      [
        context.tenantId,
        context.agreementId,
        suggestionId,
        context.email,
        source,
        hashBytes(Buffer.from(canonicalJson(source))),
      ],
    );
    const aiId = await enqueue(getPool(), {
      tenantId: context.tenantId,
      agreementId: context.agreementId,
      dedupeKey: null,
      payload: { kind: "ai_suggest", suggestionId },
    });
    const emailId = await enqueue(getPool(), {
      tenantId: context.tenantId,
      agreementId: null,
      dedupeKey: null,
      payload: {
        kind: "email",
        template: "otp_code",
        to: "signer@example.test",
        params: { code: "123456" },
      },
    });
    const [first, second] = await Promise.all([
      claimOwnJobs([aiId, emailId]),
      claimOwnJobs([aiId, emailId]),
    ]);
    const ids = [...first, ...second].map((job) => job.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(aiId);
    expect(ids).toContain(emailId);
    expect((await foreignRow()).rows).toEqual(foreignBefore.rows);
    const aiJob = [...first, ...second].find((job) => job.id === aiId);
    if (!aiJob) throw new Error("AI job not claimed");
    const reclaimed = await dueAgain(aiJob);
    expect(reclaimed.attempts).toBe(2);
    expect(reclaimed.leaseToken).not.toBe(aiJob.leaseToken);
    expect((await foreignRow()).rows).toEqual(foreignBefore.rows);
    const provider = vi.fn().mockRejectedValue(new Error("Synthetic provider refusal"));
    vi.stubGlobal("fetch", provider);
    await executeJob(reclaimed, createHandlers());
    expect(provider).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    const state = await getPool().query<{ status: string; cost_micros: string; total: string }>(
      "SELECT status,cost_micros,(SELECT sum(coalesce(cost_micros,reserved_micros))::text FROM dripsign.ai_suggestion WHERE tenant_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date) AS total FROM dripsign.ai_suggestion WHERE tenant_id=$1 AND id=$2",
      [context.tenantId, suggestionId],
    );
    expect(state.rows[0]?.status).toBe("failed");
    expect(Number(state.rows[0]?.cost_micros)).toBe(2_000_000);
    expect(Number(state.rows[0]?.total)).toBe(2_000_000);
    const outbox = await getPool().query<{ status: string }>(
      "SELECT status FROM dripsign.outbox WHERE id=$1",
      [aiId],
    );
    expect(outbox.rows[0]?.status).toBe("failed");
    await assertModelPrice();
    const handlers = createHandlers();
    const claimedEmail = [...first, ...second].find((job) => job.id === emailId);
    if (!claimedEmail) throw new Error("Email job not claimed");
    const emailJob = await dueAgain(claimedEmail);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const renew = vi
      .spyOn(outboxModule, "renewLease")
      .mockRejectedValueOnce(
        Object.assign(new Error("Private database failure"), { code: "08006" }),
      )
      .mockReturnValueOnce(new Promise<boolean>(() => undefined))
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    let jobSignal: AbortSignal | undefined;
    // The handler holds the job until its signal aborts, as a real effect would stop.
    const run = () =>
      executeJob(emailJob, {
        ...handlers,
        email: {
          ...handlers.email,
          handler: async (_job, signal) => {
            jobSignal = signal;
            await new Promise((resolve) => {
              signal.addEventListener("abort", resolve);
            });
          },
        },
      });
    vi.useFakeTimers();
    let running = run();
    // A failed renewal keeps the job, and one that never answers ends it at the claimed lease.
    await vi.advanceTimersByTimeAsync(90_000);
    expect(jobSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(jobSignal?.aborted).toBe(true);
    expect(log).toHaveBeenCalledWith("dripsign: lease renewal failed", {
      id: emailJob.id,
      code: "08006",
    });
    vi.useRealTimers();
    await running;
    const scrubbed = await getPool().query<{ params: unknown }>(
      "SELECT payload->'params' AS params FROM dripsign.outbox WHERE id=$1",
      [emailId],
    );
    expect(scrubbed.rows[0]?.params).toEqual({});
    // A confirmed renewal keeps the job; a lost lease ends it.
    vi.useFakeTimers();
    running = run();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(jobSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(jobSignal?.aborted).toBe(true);
    expect(renew).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
    await running;
    await assertRetention(context, suggestionId);
  });
});
