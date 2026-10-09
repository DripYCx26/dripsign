import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { canonicalExecutedEvidence, parseExecutedEvidence, type FrozenExecutedEvidence } from '../src/completionExport.ts';
/** Owning disposable-DB proof reads actual closed round/artifacts/export bytes, never seeds them. */
export async function retainedCompletion(pool: Pool, agreement: string, round: string): Promise<FrozenExecutedEvidence> {
  const actual = (await pool.query<{ tenant: string; eventId: string; body: string; bodyHash: string;
    freshness: number; revision: string; completed: string; signed: string; audit: string }>(`SELECT r.tenant_id AS tenant,
      e.event_id AS "eventId",e.body,e.body_sha256 AS "bodyHash",e.freshness_seconds AS freshness,
      r.revision_id AS revision,(extract(epoch FROM r.completed_at)*1000000)::numeric(30,0)::text AS completed,
      signed.document->>'sha256' AS signed,audit.document->>'sha256' AS audit
    FROM dripsign.signing_round r JOIN dripsign.agreement a ON (a.tenant_id,a.id)=(r.tenant_id,r.agreement_id)
    JOIN dripsign.completion_export e ON (e.tenant_id,e.round_id)=(r.tenant_id,r.id)
    JOIN dripsign.archived_artifact signed ON (signed.tenant_id,signed.round_id)=(r.tenant_id,r.id) AND signed.kind='signed_document'
    JOIN dripsign.archived_artifact audit ON (audit.tenant_id,audit.round_id)=(r.tenant_id,r.id) AND audit.kind='audit_record'
    WHERE r.agreement_id=$1 AND r.id=$2 AND r.status='completed' AND a.status='signed'`, [agreement, round])).rows;
  assert.equal(actual.length, 1, 'real native completed round and both archived artifacts are required');
  const row = actual[0]; assert.ok(row);
  const event = parseExecutedEvidence(JSON.parse(row.body) as unknown);
  assert.ok(row.body === canonicalExecutedEvidence(event), 'original export bytes must be canonical');
  assert.equal(row.bodyHash, createHash('sha256').update(row.body).digest('hex'));
  assert.equal(event.sourceTenantId, row.tenant); assert.equal(event.eventId, row.eventId);
  assert.equal(event.agreementId, agreement); assert.equal(event.roundId, round); assert.equal(event.revisionId, row.revision);
  assert.equal(event.completedAtMicros, Number(row.completed));
  assert.equal(event.signedDocumentSha256, row.signed); assert.equal(event.auditRecordSha256, row.audit);
  return { body: row.body, event, freshnessSeconds: row.freshness };
}
