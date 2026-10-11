import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closePool, getPool, tx } from "../db.ts";
import { AI_RESERVATION_MICROS, askAi } from "../domain/ai.ts";
import { loadState, lockAgreement, resolveAccess } from "../domain/state.ts";
import type { StaffActor } from "../types.ts";
import { canonicalJson } from "../schema.ts";
import { getStorage, hashBytes, objectKey, readBytes } from "../adapters/storage.ts";
import { completeArchive } from "../domain/signing.ts";
import { claimJobs, enqueue, finishJob, retryJob } from "./outbox.ts";
import * as outboxModule from "./outbox.ts";
import { createHandlers } from "./handlers.ts";
import { executeJob } from "./runner.ts";
import { parseConfig } from "../config.ts";
import { rescueArchives } from "./sweep.ts";
import {
  archiveFixture,
  assertModelPrices,
  assertRetention,
  dueAgain,
  fixture,
  source,
} from "./testSupport.ts";

afterEach(() => {
  vi.restoreAllMocks();
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

describe("outbox execution", () => {
  it("archives through failures with fenced leases, rescue, capped backoff and confidential logs", async () => {
    const context = await archiveFixture();
    const jobs = await claimJobs(getPool(), { limit: 100, leaseMs: 120_000 });
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
    expect(await retryJob(getPool(), current, "storage_unavailable")).toBe("retrying");
    const delay = await getPool().query<{ seconds: number }>(
      "SELECT extract(epoch FROM available_at - now())::float8 AS seconds FROM dripsign.outbox WHERE id=$1",
      [current.id],
    );
    expect(delay.rows[0]?.seconds).toBeGreaterThan(3590);
    expect(delay.rows[0]?.seconds).toBeLessThan(3601);
    await getPool().query(
      "UPDATE dripsign.outbox SET status='failed',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1",
      [current.id],
    );
    await rescueArchives();
    await rescueArchives();
    const rescued = await getPool().query<{ id: string }>(
      "SELECT id FROM dripsign.outbox WHERE kind='archive' AND tenant_id=$1 AND payload->>'roundId'=$2 AND status='pending'",
      [context.tenantId, context.roundId],
    );
    expect(rescued.rows).toHaveLength(1);
    const replacement = (await claimJobs(getPool(), { limit: 100, leaseMs: 120_000 })).find(
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
      await executeJob(current, handlers, new AbortController().signal);
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

  it("fences claims and AI spend, classifies retries, renews leases, prices models and batches retention", async () => {
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
    const suggestionId = randomUUID();
    await getPool().query(
      `INSERT INTO dripsign.ai_suggestion (tenant_id,agreement_id,id,requested_by,instruction,base_source,base_source_sha256,model,reserved_micros)
      VALUES ($1,$2,$3,$4,'Review scope',$5,$6,'claude-sonnet-5-5',2000000)`,
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
      claimJobs(getPool(), { limit: 100, leaseMs: 120_000 }),
      claimJobs(getPool(), { limit: 100, leaseMs: 120_000 }),
    ]);
    const ids = [...first, ...second].map((job) => job.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(aiId);
    expect(ids).toContain(emailId);
    const aiJob = [...first, ...second].find((job) => job.id === aiId);
    if (!aiJob) throw new Error("AI job not claimed");
    const reclaimed = await dueAgain(aiJob);
    expect(reclaimed.attempts).toBe(2);
    expect(reclaimed.leaseToken).not.toBe(aiJob.leaseToken);
    await executeJob(reclaimed, createHandlers(), new AbortController().signal);
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
    await assertModelPrices();
    const handlers = createHandlers();
    for (const code of ["08006", "57P01", "40001"]) {
      const error = Object.assign(new Error("Synthetic database failure"), { code });
      expect(handlers.host_event.retryable(error)).toBe(true);
      expect(handlers.host_event.retryable(new Error("Wrapped", { cause: error }))).toBe(true);
    }
    expect(
      handlers.host_event.retryable(Object.assign(new Error("Invalid data"), { code: "23503" })),
    ).toBe(false);
    const emailJob = [...first, ...second].find((job) => job.id === emailId);
    if (!emailJob) throw new Error("Email job not claimed");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const renew = vi
      .spyOn(outboxModule, "renewLease")
      .mockRejectedValueOnce(
        Object.assign(new Error("Private database failure"), { code: "08006" }),
      )
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    vi.useFakeTimers();
    let jobSignal: AbortSignal | undefined;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = executeJob(
      emailJob,
      {
        ...handlers,
        email: {
          ...handlers.email,
          handler: async (_job, signal) => {
            jobSignal = signal;
            await blocked;
          },
        },
      },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(jobSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(jobSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(jobSignal?.aborted).toBe(true);
    expect(renew).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledWith("dripsign: lease renewal failed", {
      id: emailJob.id,
      code: "08006",
    });
    vi.useRealTimers();
    release?.();
    await running;
    await assertRetention(context, suggestionId);
  });

  it("admits exactly one of two concurrent ask_ai calls at the daily cap", async () => {
    const first = await fixture();
    const second = await fixture(first.tenantId);
    const actor: StaffActor = {
      capacity: "staff",
      tenantId: first.tenantId,
      email: first.email,
      sessionId: randomUUID(),
      verifiedAt: new Date().toISOString(),
      role: "admin",
    };
    const ask = (agreementId: string) =>
      tx(async (db) => {
        const access = await resolveAccess(db, actor, agreementId);
        const agreement = await lockAgreement(db, first.tenantId, agreementId, null);
        const state = await loadState(db, agreement, actor);
        await askAi(
          { db, actor, agreement, access, state },
          { kind: "ask_ai", instruction: "Review this synthetic scope." },
        );
      });
    const results = await Promise.allSettled([ask(first.agreementId), ask(second.agreementId)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected");
    if (!refused) throw new Error("Concurrent AI request was not refused");
    expect(refused.reason).toMatchObject({ code: "rate_limited" });
    const suggestions = await getPool().query<{ count: string; total: string }>(
      "SELECT count(*)::text AS count, sum(reserved_micros)::text AS total FROM dripsign.ai_suggestion WHERE tenant_id=$1",
      [first.tenantId],
    );
    expect(Number(suggestions.rows[0]?.count)).toBe(1);
    expect(Number(suggestions.rows[0]?.total)).toBe(AI_RESERVATION_MICROS);
  });
});
