import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closePool, getPool, tx } from "../db.ts";
import { AI_RESERVATION_MICROS, askAi } from "../domain/ai.ts";
import { loadState, lockAgreement, resolveAccess } from "../domain/state.ts";
import type { StaffActor } from "../types.ts";
import { canonicalJson, SIGNING_CONSENT } from "../schema.ts";
import { getStorage, hashBytes, objectKey, readBytes, storeBytes } from "../adapters/storage.ts";
import { prepareDraftPdf } from "../pdf/prepare.ts";
import { claimJobs, enqueue, finishJob } from "./outbox.ts";
import type { ClaimedJob } from "./outbox.ts";
import { createHandlers } from "./handlers.ts";
import { executeJob } from "./runner.ts";

beforeAll(() => {
  vi.stubEnv("DRIPSIGN_ANTHROPIC_API_KEY", "synthetic-not-a-provider-key");
  vi.stubEnv("DRIPSIGN_AI_DAILY_LIMIT_USD", "1");
});
afterAll(async () => {
  await closePool();
  vi.unstubAllEnvs();
});

const source = {
  title: "Synthetic agreement",
  sections: [{ id: "scope", heading: "Scope", paragraphs: ["Provide synthetic services."] }],
};

async function fixture(tenantId = randomUUID()) {
  const db = getPool();
  const agreementId = randomUUID();
  const recipientId = randomUUID();
  const email = "staff@example.test";
  const draft = {
    source,
    upload: null,
    document: null,
    signingFields: [],
    signerIds: [recipientId],
    preparation: { status: "empty", error: null, inputSha256: null, signerSetHash: null },
  };
  await db.query("INSERT INTO dripsign.tenant (id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
    tenantId,
    tenantId,
  ]);
  await db.query(
    "INSERT INTO dripsign.staff (tenant_id,email,role) VALUES ($1,$2,'admin') ON CONFLICT DO NOTHING",
    [tenantId, email],
  );
  await db.query(
    "INSERT INTO dripsign.agreement (tenant_id,id,title,draft,created_by) VALUES ($1,$2,$3,$4,$5)",
    [tenantId, agreementId, source.title, draft, email],
  );
  await db.query(
    "INSERT INTO dripsign.recipient (tenant_id,agreement_id,id,email,name,is_signer) VALUES ($1,$2,$3,'signer@example.test','Jordan Lee',true)",
    [tenantId, agreementId, recipientId],
  );
  return { tenantId, agreementId, recipientId, email };
}

async function archiveFixture() {
  const context = await fixture();
  const { tenantId, agreementId, recipientId, email } = context;
  const db = getPool();
  const revisionId = randomUUID();
  const roundId = randomUUID();
  const prepared = await prepareDraftPdf({
    title: source.title,
    source,
    signers: [{ id: recipientId, name: "Jordan Lee", email: "signer@example.test" }],
  });
  const document = await storeBytes(tenantId, prepared.bytes);
  await db.query(
    `INSERT INTO dripsign.revision (tenant_id,agreement_id,id,number,document_sha256,document_bytes,page_count,source,signing_fields,signer_ids,published_by)
    VALUES ($1,$2,$3,1,$4,$5,2,$6,$7,$8,$9)`,
    [
      tenantId,
      agreementId,
      revisionId,
      document.sha256,
      document.byteLength,
      source,
      JSON.stringify(prepared.fields),
      [recipientId],
      email,
    ],
  );
  await db.query(
    "UPDATE dripsign.agreement SET current_revision_id=$3,status='signing' WHERE tenant_id=$1 AND id=$2",
    [tenantId, agreementId, revisionId],
  );
  await db.query(
    `INSERT INTO dripsign.signing_round (tenant_id,agreement_id,id,revision_id,document_sha256,consent_version,consent_text,consent_hash,requested_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      tenantId,
      agreementId,
      roundId,
      revisionId,
      document.sha256,
      SIGNING_CONSENT.version,
      SIGNING_CONSENT.text,
      SIGNING_CONSENT.sha256,
      email,
    ],
  );
  await db.query(
    "INSERT INTO dripsign.round_signer (tenant_id,agreement_id,round_id,recipient_id,name,email) VALUES ($1,$2,$3,$4,'Jordan Lee','signer@example.test')",
    [tenantId, agreementId, roundId, recipientId],
  );
  await db.query(
    `INSERT INTO dripsign.signature (tenant_id,agreement_id,round_id,recipient_id,typed_name,consent_version,consent_text,consent_hash,document_sha256,session_id,verified_at)
    VALUES ($1,$2,$3,$4,'Jordan Lee',$5,$6,$7,$8,$9,now())`,
    [
      tenantId,
      agreementId,
      roundId,
      recipientId,
      SIGNING_CONSENT.version,
      SIGNING_CONSENT.text,
      SIGNING_CONSENT.sha256,
      document.sha256,
      randomUUID(),
    ],
  );
  await db.query(
    "UPDATE dripsign.signing_round SET status='finalizing',finalizing_at=now() WHERE tenant_id=$1 AND id=$2",
    [tenantId, roundId],
  );
  const jobId = await enqueue(db, {
    tenantId,
    agreementId,
    dedupeKey: null,
    payload: { kind: "archive", roundId },
  });
  return { ...context, roundId, jobId };
}

async function dueAgain(job: ClaimedJob): Promise<ClaimedJob> {
  await getPool().query(
    "UPDATE dripsign.outbox SET available_at=now()-interval '1 second',lease_until=CASE WHEN status='running' THEN now()-interval '1 second' ELSE NULL END WHERE id=$1",
    [job.id],
  );
  const jobs = await claimJobs(getPool(), { limit: 100, leaseMs: 120_000 });
  const reclaimed = jobs.find((candidate) => candidate.id === job.id);
  if (!reclaimed) throw new Error("Test job was not reclaimed");
  return reclaimed;
}

describe("outbox execution", () => {
  it("archives despite two storage failures, preserves artifact hashes and refuses stale lease finish", async () => {
    const context = await archiveFixture();
    const jobs = await claimJobs(getPool(), { limit: 100, leaseMs: 120_000 });
    const stale = jobs.find((job) => job.id === context.jobId);
    if (!stale) throw new Error("Archive was not claimed");
    let current = await dueAgain(stale);
    expect(await finishJob(getPool(), stale)).toBe(false);
    const storage = getStorage();
    let failures = 0;
    const handlers = createHandlers({
      get: (key) => storage.get(key),
      put: async (key, bytes) => {
        if (failures++ < 2) throw new Error("Synthetic storage outage");
        await storage.put(key, bytes);
      },
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      await executeJob(current, handlers, new AbortController().signal);
      if (attempt < 2) {
        const state = await getPool().query<{ status: string }>(
          "SELECT status FROM dripsign.outbox WHERE id=$1",
          [current.id],
        );
        expect(state.rows[0]?.status).toBe("pending");
        current = await dueAgain(current);
      }
    }
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
    }
  });

  it("never double claims, reclaims expiry and fails a reclaimed AI job while keeping its reservation", async () => {
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
    const state = await getPool().query<{ status: string; reserved_micros: string }>(
      "SELECT status,reserved_micros FROM dripsign.ai_suggestion WHERE tenant_id=$1 AND id=$2",
      [context.tenantId, suggestionId],
    );
    expect(state.rows[0]?.status).toBe("failed");
    expect(Number(state.rows[0]?.reserved_micros)).toBe(2_000_000);
    const outbox = await getPool().query<{ status: string }>(
      "SELECT status FROM dripsign.outbox WHERE id=$1",
      [aiId],
    );
    expect(outbox.rows[0]?.status).toBe("failed");
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
