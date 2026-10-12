import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { getPool } from "../db.ts";
import { SIGNING_CONSENT } from "../schema.ts";
import { loadArchiveEvidence } from "./archive.ts";

it("refuses edited or out-of-order signatures, skipped finalizing, or signing without artifacts", async () => {
  const db = getPool();
  const [tenant, agreement, revision, recipient, round] = [1, 2, 3, 4, 5].map(() => randomUUID());
  const sha256 = "a".repeat(64);
  await db.query("INSERT INTO dripsign.tenant (id, name) VALUES ($1, $2)", [
    tenant,
    `Evidence ${String(tenant)}`,
  ]);
  await db.query(
    `INSERT INTO dripsign.agreement (tenant_id, id, title, draft, created_by)
     VALUES ($1, $2, 'Evidence', '{}', 'staff@evidence.test')`,
    [tenant, agreement],
  );
  await db.query(
    `INSERT INTO dripsign.recipient (tenant_id, agreement_id, id, email, name, is_signer)
     VALUES ($1, $2, $3, 'signer@evidence.test', 'Signer', true)`,
    [tenant, agreement, recipient],
  );
  await db.query(
    `INSERT INTO dripsign.revision (tenant_id, agreement_id, id, number, document_sha256,
       document_bytes, page_count, source, signing_fields, signer_ids, published_by)
     VALUES ($1, $2, $3, 1, $4, 10, 1, '{}', '[]', ARRAY[$5::uuid], 'staff@evidence.test')`,
    [tenant, agreement, revision, sha256, recipient],
  );
  await db.query(
    `UPDATE dripsign.agreement SET status = 'signing', current_revision_id = $3
     WHERE tenant_id = $1 AND id = $2`,
    [tenant, agreement, revision],
  );
  await db.query(
    `INSERT INTO dripsign.signing_round (tenant_id, agreement_id, id, revision_id, document_sha256,
       consent_version, consent_text, consent_hash, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'staff@evidence.test')`,
    [
      tenant,
      agreement,
      round,
      revision,
      sha256,
      SIGNING_CONSENT.version,
      SIGNING_CONSENT.text,
      SIGNING_CONSENT.sha256,
    ],
  );
  await db.query(
    `INSERT INTO dripsign.round_signer (tenant_id, agreement_id, round_id, recipient_id, name, email)
     VALUES ($1, $2, $3, $4, 'Signer', 'signer@evidence.test')`,
    [tenant, agreement, round, recipient],
  );
  const sign = (verifiedAfterNow: string) =>
    db.query(
      `INSERT INTO dripsign.signature (tenant_id, agreement_id, round_id, recipient_id, typed_name,
         consent_version, consent_text, consent_hash, document_sha256, session_id, verified_at,
         signed_at)
       SELECT tenant_id, agreement_id, id, $3, 'Signer', consent_version, consent_text,
         consent_hash, document_sha256, gen_random_uuid(), now() + $4::interval,
         date_trunc('milliseconds', clock_timestamp()) + interval '1500 microseconds'
       FROM dripsign.signing_round WHERE tenant_id = $1 AND id = $2`,
      [tenant, round, recipient, verifiedAfterNow],
    );
  await expect(sign("1 minute")).rejects.toThrow(/verified_before_signed/u);
  await sign("0 seconds");

  await expect(
    db.query(
      `UPDATE dripsign.signing_round
       SET status = 'completed', finalizing_at = now(), ended_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenant, round],
    ),
  ).rejects.toThrow(/cannot move from active to completed/u);
  await expect(
    db.query(
      "UPDATE dripsign.signature SET typed_name = 'Someone Else' WHERE tenant_id = $1 AND round_id = $2",
      [tenant, round],
    ),
  ).rejects.toThrow(/Immutable evidence cannot be changed: signature/u);
  await expect(
    db.query(
      `UPDATE dripsign.signing_round
       SET status = 'finalizing', finalizing_at = now() - interval '1 minute'
       WHERE tenant_id = $1 AND id = $2`,
      [tenant, round],
    ),
  ).rejects.toThrow(/Every signature must precede finalizing/u);
  // Signed mid-millisecond and finalized a microsecond later: the audit timeline keeps it.
  await db.query(
    `UPDATE dripsign.signing_round SET status = 'finalizing', finalizing_at = (
       SELECT signed_at + interval '1 microsecond' FROM dripsign.signature
       WHERE tenant_id = $1 AND round_id = $2)
     WHERE tenant_id = $1 AND id = $2`,
    [tenant, round],
  );
  const evidence = await loadArchiveEvidence(db, {
    tenantId: String(tenant),
    roundId: String(round),
  });
  expect(evidence?.timeline.map((item) => item.kind)).toContain("signature_recorded");
  await expect(
    db.query("UPDATE dripsign.agreement SET status = 'signed' WHERE tenant_id = $1 AND id = $2", [
      tenant,
      agreement,
    ]),
  ).rejects.toThrow(/both archived artifacts are required/u);
});
