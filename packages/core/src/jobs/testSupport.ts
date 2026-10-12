import { randomUUID } from "node:crypto";
import { expect, vi } from "vitest";
import { suggestEdits } from "../adapters/anthropic.ts";
import { getPool } from "../db.ts";
import type { Db } from "../db.ts";
import { hashBytes, storeBytes } from "../adapters/storage.ts";
import { canonicalJson, SIGNING_CONSENT } from "../schema.ts";
import { prepareDraftPdf } from "../pdf/prepare.ts";
import { claimJobs, enqueue } from "./outbox.ts";
import type { ClaimedJob } from "./outbox.ts";
import { sweepRetention } from "./sweep.ts";

interface Context {
  tenantId: string;
  agreementId: string;
  email: string;
}

export const source = {
  title: "Synthetic agreement",
  sections: [{ id: "scope", heading: "Scope", paragraphs: ["Provide synthetic services."] }],
};

export async function fixture(tenantId = randomUUID()) {
  const db = getPool();
  const agreementId = randomUUID();
  const recipientId = randomUUID();
  const email = "staff@example.test";
  const draft = {
    source,
    document: null,
    signingFields: [],
    signerIds: [recipientId],
    preparation: {
      status: "preparing",
      error: null,
      inputSha256: "a".repeat(64),
      signerSetHash: "b".repeat(64),
    },
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

export async function archiveFixture() {
  const context = await fixture();
  const { tenantId, agreementId, recipientId, email } = context;
  const db = getPool();
  const revisionId = randomUUID();
  const roundId = randomUUID();
  const prepared = await prepareDraftPdf({
    source,
    signers: [{ id: recipientId, name: "Jordan Lee", email: "signer@example.test" }],
    revision: 1,
    organisation: "Northwind Studio",
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
  return { ...context, roundId, jobId, document };
}

export function claimOwnJobs(ids: readonly (string | null)[]): Promise<ClaimedJob[]> {
  // Exercise the real claim statement, with a test-only fence before it can lease foreign jobs.
  const db = {
    query: (sql: string, values: unknown[]) =>
      getPool().query(sql.replace("WHERE status IN", "WHERE id = ANY($3::uuid[]) AND status IN"), [
        ...values,
        ids,
      ]),
  } as Db;
  return claimJobs(db, { limit: 100, leaseMs: 120_000 });
}

export async function dueAgain(job: ClaimedJob): Promise<ClaimedJob> {
  await getPool().query(
    "UPDATE dripsign.outbox SET available_at=now()-interval '1 second' WHERE id=$1",
    [job.id],
  );
  const jobs = await claimOwnJobs([job.id]);
  const reclaimed = jobs.find((candidate) => candidate.id === job.id);
  if (!reclaimed) throw new Error("Test job was not reclaimed");
  return reclaimed;
}

async function seedRetention(context: Context, suggestionId: string): Promise<void> {
  const db = getPool();
  const sha256 = "a".repeat(64);
  await db.query(
    `INSERT INTO dripsign.command_receipt (tenant_id,actor_email,key,operation,capacity,payload_sha256,created_at)
     SELECT $1,$2,'synthetic-old-' || n,'test','staff',$3,now()-interval '31 days'
     FROM generate_series(1,1001) n`,
    [context.tenantId, context.email, sha256],
  );
  await db.query(
    `INSERT INTO dripsign.command_receipt (tenant_id,actor_email,key,operation,capacity,payload_sha256,created_at)
     VALUES ($1,$2,'synthetic-recent','test','staff',$3,now()-interval '29 days')`,
    [context.tenantId, context.email, sha256],
  );
  await db.query(
    "UPDATE dripsign.ai_suggestion SET finished_at=now()-interval '91 days' WHERE tenant_id=$1 AND id=$2",
    [context.tenantId, suggestionId],
  );
  const source = {
    title: "Synthetic",
    sections: [{ id: "scope", heading: "Scope", paragraphs: ["Synthetic."] }],
  };
  await db.query(
    `INSERT INTO dripsign.ai_suggestion (tenant_id,agreement_id,id,requested_by,instruction,base_source,base_source_sha256,model,reserved_micros,status,result,finished_at,applied_at,created_at)
     SELECT $1,$2,gen_random_uuid(),$3,'Synthetic',$4,$5,'claude-sonnet-5-5',1000,status,
       CASE WHEN status IN ('ready','applied') THEN '{}'::jsonb END,
       CASE WHEN status <> 'queued' THEN now()-interval '91 days' END,
       CASE WHEN status='applied' THEN now()-interval '91 days' END,now()-interval '91 days'
     FROM unnest(ARRAY['ready','failed','applied','queued']) AS status`,
    [
      context.tenantId,
      context.agreementId,
      context.email,
      source,
      hashBytes(Buffer.from(canonicalJson(source))),
    ],
  );
  await db.query(
    `INSERT INTO dripsign.ai_suggestion (tenant_id,agreement_id,id,requested_by,instruction,base_source,base_source_sha256,model,reserved_micros,status,result,finished_at)
     VALUES ($1,$2,gen_random_uuid(),$3,'Synthetic',$4,$5,'claude-sonnet-5-5',1000,'ready','{}',now()-interval '89 days')`,
    [
      context.tenantId,
      context.agreementId,
      context.email,
      source,
      hashBytes(Buffer.from(canonicalJson(source))),
    ],
  );
}

export async function assertRetention(context: Context, suggestionId: string): Promise<void> {
  await seedRetention(context, suggestionId);
  const receipts = () =>
    getPool().query<{ count: string }>(
      "SELECT count(*)::text AS count FROM dripsign.command_receipt WHERE tenant_id=$1",
      [context.tenantId],
    );
  await sweepRetention();
  expect(Number((await receipts()).rows[0]?.count)).toBe(2);
  const suggestions = await getPool().query<{ status: string; finished_at: Date | null }>(
    "SELECT status,finished_at FROM dripsign.ai_suggestion WHERE tenant_id=$1 ORDER BY status",
    [context.tenantId],
  );
  expect(suggestions.rows.map((row) => row.status)).toEqual(["queued", "ready"]);
  await sweepRetention();
  expect(Number((await receipts()).rows[0]?.count)).toBe(1);
}

export async function assertModelPrice(): Promise<void> {
  const fetch = vi.spyOn(globalThis, "fetch");
  const called = vi.fn();
  try {
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          stop_reason: "tool_use",
          usage: { input_tokens: 2, output_tokens: 3 },
          content: [
            {
              type: "tool_use",
              name: "suggest_edits",
              input: { source, summary: "Synthetic", questions: [] },
            },
          ],
        }),
      ),
    );
    const result = await suggestEdits({ source, instruction: "Synthetic" }, undefined, called);
    expect(result.costMicros).toBe(34);
    expect(called).toHaveBeenCalledOnce();
  } finally {
    fetch.mockRestore();
  }
}
