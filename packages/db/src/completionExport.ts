import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { StoreError } from './types.ts';

/** Explicit admitted destination/public authority; no secret or arbitrary URL is accepted. */
export interface CompletionExportConfig {
  readonly tenantId: string; readonly senderBindingId: string; readonly senderBindingRevision: number;
  readonly senderGrantId: string; readonly issuer: string; readonly audience: string; readonly keyId: string;
  readonly keyVersion: number; readonly freshnessSeconds: number;
}
/** All execution facts derive from actual archived completion custody, not a caller's status. */
export interface ExecutedEvidence {
  readonly schemaVersion: 1; readonly kind: 'agreement_executed'; readonly issuer: string;
  readonly audience: string; readonly keyId: string; readonly keyVersion: number;
  readonly senderBindingId: string; readonly senderBindingRevision: number; readonly senderGrantId: string;
  readonly eventId: string; readonly tenantId: string; readonly sourceTenantId: string;
  readonly agreementId: string; readonly revisionId: string; readonly roundId: string;
  readonly completedAtMicros: number; readonly signedDocumentSha256: string; readonly auditRecordSha256: string;
}
function object(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== [...fields].sort().join(',')) throw new StoreError('invalid', 'Export shape is invalid');
  return input as Record<string, unknown>;
}
function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new StoreError('invalid', 'Export field is invalid');
  return value;
}
function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new StoreError('invalid', 'Export count is invalid');
  }
  return value;
}
const UUID = /^(?!00000000-0000-0000-0000-000000000000$)[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const IDENTIFIER = /^[!-~]{1,100}$/;
/** Rejects unknown fields and malformed explicit sender enrollment without a new dependency. */
export function parseCompletionExportConfig(input: unknown): CompletionExportConfig {
  const v = object(input, ['tenantId','senderBindingId','senderBindingRevision','senderGrantId','issuer','audience','keyId','keyVersion','freshnessSeconds']);
  return { tenantId: text(v['tenantId'], UUID), senderBindingId: text(v['senderBindingId'], UUID),
    senderBindingRevision: integer(v['senderBindingRevision'], 1), senderGrantId: text(v['senderGrantId'], UUID),
    issuer: text(v['issuer'], IDENTIFIER), audience: text(v['audience'], IDENTIFIER), keyId: text(v['keyId'], IDENTIFIER),
    keyVersion: integer(v['keyVersion'], 1, 4_294_967_295), freshnessSeconds: integer(v['freshnessSeconds'], 1, 300) };
}
/** Closed bounded facts; transport and DB independently reject a changed immutable body. */
export function parseExecutedEvidence(input: unknown): ExecutedEvidence {
  const v = object(input, ['schemaVersion','kind','issuer','audience','keyId','keyVersion','senderBindingId','senderBindingRevision','senderGrantId','eventId','tenantId','sourceTenantId','agreementId','revisionId','roundId','completedAtMicros','signedDocumentSha256','auditRecordSha256']);
  if (v['schemaVersion'] !== 1 || v['kind'] !== 'agreement_executed') throw new StoreError('invalid', 'Export kind is invalid');
  return { schemaVersion: 1, kind: 'agreement_executed', issuer: text(v['issuer'], IDENTIFIER),
    audience: text(v['audience'], IDENTIFIER), keyId: text(v['keyId'], IDENTIFIER),
    keyVersion: integer(v['keyVersion'], 1, 4_294_967_295), senderBindingId: text(v['senderBindingId'], UUID),
    senderBindingRevision: integer(v['senderBindingRevision'], 1), senderGrantId: text(v['senderGrantId'], UUID),
    eventId: text(v['eventId'], UUID), tenantId: text(v['tenantId'], UUID), sourceTenantId: text(v['sourceTenantId'], UUID),
    agreementId: text(v['agreementId'], UUID), revisionId: text(v['revisionId'], UUID), roundId: text(v['roundId'], UUID),
    completedAtMicros: integer(v['completedAtMicros'], -Number.MAX_SAFE_INTEGER),
    signedDocumentSha256: text(v['signedDocumentSha256'], /^[a-f0-9]{64}$/),
    auditRecordSha256: text(v['auditRecordSha256'], /^[a-f0-9]{64}$/) };
}
/** Immutable wire bytes are kept apart from per-attempt delivery timestamps. */
export interface FrozenExecutedEvidence { readonly body: string; readonly event: ExecutedEvidence; readonly freshnessSeconds: number }

/** ASCII closed fields and lexicographically sorted keys match serde_json's canonical map bytes. */
export function canonicalExecutedEvidence(event: ExecutedEvidence): string {
  const parsed = parseExecutedEvidence(event);
  return JSON.stringify(Object.fromEntries(Object.entries(parsed).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}

/** Captures immutable completion bytes once, reusing the source outbox's actual event identity. */
export async function freezeCompletionExport(client: PoolClient, sourceTenant: string,
  agreement: string, round: string): Promise<FrozenExecutedEvidence | null> {
  const completed = (await client.query<{ revision: string; completedMicros: string;
    signedHash: string; auditHash: string }>(`SELECT r.revision_id AS revision,
      (extract(epoch FROM r.completed_at)*1000000)::numeric(30,0)::text AS "completedMicros",
      signed.document->>'sha256' AS "signedHash",audit.document->>'sha256' AS "auditHash"
    FROM dripsign.signing_round r JOIN dripsign.agreement a ON a.tenant_id=r.tenant_id AND a.id=r.agreement_id
    JOIN dripsign.archived_artifact signed ON signed.tenant_id=r.tenant_id AND signed.round_id=r.id AND signed.kind='signed_document'
    JOIN dripsign.archived_artifact audit ON audit.tenant_id=r.tenant_id AND audit.round_id=r.id AND audit.kind='audit_record'
    WHERE r.tenant_id=$1 AND r.agreement_id=$2 AND r.id=$3 AND r.status='completed'
      AND r.completed_at IS NOT NULL AND a.status='signed' AND a.current_revision_id=r.revision_id
    FOR SHARE OF r,a`, [sourceTenant, agreement, round])).rows[0];
  if (!completed) throw new StoreError('conflict', 'Archived completion is unavailable');
  // A completion transaction already created this outbox. Recovery must not fabricate an event.
  const message = (await client.query<{ id: string; receipt: string | null }>(`SELECT id,receipt FROM dripsign.outbox
    WHERE tenant_id=$1 AND agreement_id=$2 AND dedupe_key=$3 AND kind='agreement_executed' FOR UPDATE`,
    [sourceTenant, agreement, `executed:${round}`])).rows[0];
  if (!message) throw new StoreError('conflict', 'Completion event is unavailable');
  const prior = (await client.query<{ body: string; freshness: number }>(`SELECT body,freshness_seconds AS freshness
    FROM dripsign.completion_export WHERE tenant_id=$1 AND round_id=$2`, [sourceTenant, round])).rows[0];
  if (!prior && message.receipt?.startsWith("external_evidence:")) throw new StoreError('conflict', 'Original export custody is missing');
  if (prior) return checkedExport(prior.body, prior.freshness, sourceTenant, message.id, agreement, round, completed);
  const config = (await client.query<{ config: unknown }>(`SELECT config FROM dripsign.completion_export_config
    WHERE tenant_id=$1 ORDER BY revision DESC LIMIT 1`, [sourceTenant])).rows[0];
  if (!config) return null;
  const admitted = parseCompletionExportConfig(config.config);
  const event: ExecutedEvidence = { schemaVersion: 1, kind: 'agreement_executed', issuer: admitted.issuer,
    audience: admitted.audience, keyId: admitted.keyId, keyVersion: admitted.keyVersion,
    senderBindingId: admitted.senderBindingId, senderBindingRevision: admitted.senderBindingRevision,
    senderGrantId: admitted.senderGrantId, eventId: message.id, tenantId: admitted.tenantId,
    sourceTenantId: sourceTenant, agreementId: agreement, revisionId: completed.revision, roundId: round,
    completedAtMicros: Number(completed.completedMicros), signedDocumentSha256: completed.signedHash,
    auditRecordSha256: completed.auditHash };
  const body = canonicalExecutedEvidence(event);
  await client.query(`INSERT INTO dripsign.completion_export(tenant_id,round_id,event_id,body,body_sha256,freshness_seconds)
    VALUES($1,$2,$3,$4,$5,$6)`, [sourceTenant, round, message.id, body,
    createHash('sha256').update(body).digest('hex'), admitted.freshnessSeconds]);
  return { body, event, freshnessSeconds: admitted.freshnessSeconds };
}

function checkedExport(body: string, freshness: number, tenant: string, eventId: string, agreement: string,
  round: string, actual: { revision: string; completedMicros: string; signedHash: string; auditHash: string }): FrozenExecutedEvidence {
  const event = parseExecutedEvidence(JSON.parse(body) as unknown);
  if (canonicalExecutedEvidence(event) !== body || event.sourceTenantId !== tenant || event.eventId !== eventId
    || event.agreementId !== agreement || event.roundId !== round || event.revisionId !== actual.revision
    || event.completedAtMicros !== Number(actual.completedMicros) || event.signedDocumentSha256 !== actual.signedHash
    || event.auditRecordSha256 !== actual.auditHash || !Number.isInteger(freshness) || freshness < 1 || freshness > 300) {
    throw new StoreError('conflict', 'Archived completion changed');
  }
  return { body, event, freshnessSeconds: freshness };
}

/** Staff authorization is checked by the caller before and after these bounded configured writes. */
export async function configureCompletionExport(client: PoolClient, tenant: string, expected: number,
  input: CompletionExportConfig): Promise<number> {
  const config = parseCompletionExportConfig(input);
  if (!Number.isSafeInteger(expected) || expected < 0 || expected >= Number.MAX_SAFE_INTEGER) {
    throw new StoreError('invalid', 'Export revision is invalid');
  }
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`dripsign:completion-config:${tenant}`]);
  const prior = (await client.query<{ revision: string }>(`SELECT revision::text FROM dripsign.completion_export_config
    WHERE tenant_id=$1 ORDER BY revision DESC LIMIT 1`, [tenant])).rows[0];
  if (Number(prior?.revision ?? 0) !== expected) throw new StoreError('conflict', 'Export configuration changed');
  await client.query('INSERT INTO dripsign.completion_export_config(tenant_id,revision,config) VALUES($1,$2,$3)',
    [tenant, expected + 1, JSON.stringify(config)]);
  return expected + 1;
}

/** Requeues only the original idempotent completed event; immutable body/key pins never change. */
export async function recoverCompletionExport(client: PoolClient, tenant: string,
  agreement: string, round: string): Promise<string> {
  const frozen = await freezeCompletionExport(client, tenant, agreement, round);
  if (!frozen) throw new StoreError('conflict', 'Export configuration is unavailable');
  const changed = await client.query(`UPDATE dripsign.outbox SET status='pending',attempts=0,
    available_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,effect_started_at=NULL,receipt=NULL
    WHERE tenant_id=$1 AND id=$2 AND (status<>'delivered' OR coalesce(receipt,'') !~ '^external_evidence:[a-f0-9-]{36}$')
      AND (status<>'delivering' OR lease_until<=clock_timestamp())`, [tenant, frozen.event.eventId]);
  const message = (await client.query<{ status: string }>('SELECT status FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2',
    [tenant, frozen.event.eventId])).rows[0];
  if (!changed.rowCount && message?.status !== 'delivered') throw new StoreError('conflict', 'Export is still held');
  return frozen.event.eventId;
}
