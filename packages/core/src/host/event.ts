// The agreement-executed event in the exact shape Dreach's receiver verifies: a closed 18-field
// canonical JSON body and an Ed25519 signature over a binary delivery frame
// (dreach crates/dr-authority/src/external_signing.rs). It reports evidence; it grants nothing.
import { createHash, createPrivateKey, sign } from "node:crypto";
import { loadConfig } from "../config.ts";
import type { HostConfig } from "../config.ts";
import type { Db } from "../db.ts";
import { canonicalJson } from "../schema.ts";

export const EVENT_PATH = "/v1/webhooks/dripsign";
const FRAME_LABEL = "dreach.dripsign.executed\0";
const FRAME_VERSION = 1;
/** Dreach's freshness ceiling: expiry is at most this long after issue. */
const DELIVERY_LIFETIME_MICROS = 300_000_000n;
/** PKCS#8 wrapping for a raw RFC 8032 seed, so node:crypto can load it. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export type HostEventConfig = NonNullable<HostConfig["tenants"][number]["event"]>;

/** The completed round's facts; `tenantId` is DripSign's tenant (the body's `sourceTenantId`). */
export interface ExecutedFacts {
  readonly eventId: string;
  readonly tenantId: string;
  readonly agreementId: string;
  readonly revisionId: string;
  readonly roundId: string;
  readonly completedAtMicros: number;
  readonly signedDocumentSha256: string;
  readonly auditRecordSha256: string;
}

export interface SignedEvent {
  readonly body: string;
  readonly frame: Buffer;
  readonly headers: Readonly<Record<string, string>>;
}

export interface HostEventRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * Builds a freshly stamped delivery for a completed round. Call it per attempt: the signature
 * expires after five minutes. Throws when the tenant no longer has a host event configured.
 */
export async function buildExecutedEvent(
  db: Db,
  input: { readonly tenantId: string; readonly roundId: string },
): Promise<HostEventRequest> {
  const config = loadConfig();
  const event = config.host?.tenants.find((tenant) => tenant.tenantId === input.tenantId)?.event;
  if (!event || config.hostEventSeed === null) {
    throw new Error("No host event is configured for this tenant");
  }
  const { facts, nowMicros } = await loadRound(db, input.tenantId, input.roundId);
  const seed = Buffer.from(config.hostEventSeed, "base64url");
  const signed = signExecutedEvent(event, facts, seed, nowMicros);
  return { url: new URL(EVENT_PATH, event.url).href, headers: signed.headers, body: signed.body };
}

/** Pure: the canonical body, its delivery frame and the headers carrying the signature. */
export function signExecutedEvent(
  event: HostEventConfig,
  facts: ExecutedFacts,
  seed: Buffer,
  issuedMicros: bigint,
): SignedEvent {
  const body = canonicalJson({
    schemaVersion: 1,
    kind: "agreement_executed",
    issuer: event.issuer,
    audience: event.audience,
    keyId: event.keyId,
    keyVersion: event.keyVersion,
    senderBindingId: event.senderBindingId,
    senderBindingRevision: event.senderBindingRevision,
    senderGrantId: event.senderGrantId,
    tenantId: event.hostTenantId,
    sourceTenantId: facts.tenantId,
    eventId: facts.eventId,
    agreementId: facts.agreementId,
    revisionId: facts.revisionId,
    roundId: facts.roundId,
    completedAtMicros: facts.completedAtMicros,
    signedDocumentSha256: facts.signedDocumentSha256,
    auditRecordSha256: facts.auditRecordSha256,
  });
  const expiresMicros = issuedMicros + DELIVERY_LIFETIME_MICROS;
  const frame = deliveryFrame(event, issuedMicros, expiresMicros, body);
  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  return {
    body,
    frame,
    headers: {
      "content-type": "application/json",
      "x-dripsign-issued-at-micros": issuedMicros.toString(),
      "x-dripsign-expires-at-micros": expiresMicros.toString(),
      "x-dripsign-signature": sign(null, frame, key).toString("base64url"),
    },
  };
}

function deliveryFrame(
  event: HostEventConfig,
  issuedMicros: bigint,
  expiresMicros: bigint,
  body: string,
): Buffer {
  const fields = ["POST", EVENT_PATH, event.issuer, event.audience, event.keyId].map((field) => {
    const bytes = Buffer.from(field, "ascii");
    return Buffer.concat([uint32(bytes.length), bytes]);
  });
  const times = Buffer.alloc(16);
  times.writeBigInt64BE(issuedMicros, 0);
  times.writeBigInt64BE(expiresMicros, 8);
  return Buffer.concat([
    Buffer.from(FRAME_LABEL, "ascii"),
    uint32(FRAME_VERSION),
    ...fields,
    uint32(event.keyVersion),
    times,
    createHash("sha256").update(body, "utf8").digest(),
  ]);
}

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

interface RoundRow {
  agreement_id: string;
  revision_id: string;
  completed_micros: string;
  now_micros: string;
  signed_sha256: string | null;
  audit_sha256: string | null;
}

// Times come from the database clock in whole microseconds, so completion never follows issue.
async function loadRound(
  db: Db,
  tenantId: string,
  roundId: string,
): Promise<{ facts: ExecutedFacts; nowMicros: bigint }> {
  const found = await db.query<RoundRow>(
    `SELECT g.agreement_id, g.revision_id,
       (extract(epoch FROM g.ended_at) * 1000000)::bigint::text AS completed_micros,
       (extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text AS now_micros,
       max(f.sha256) FILTER (WHERE f.kind = 'signed_document') AS signed_sha256,
       max(f.sha256) FILTER (WHERE f.kind = 'audit_record') AS audit_sha256
     FROM dripsign.signing_round g
     JOIN dripsign.artifact f ON f.tenant_id = g.tenant_id AND f.round_id = g.id
     WHERE g.tenant_id = $1 AND g.id = $2 AND g.status = 'completed'
     GROUP BY g.agreement_id, g.revision_id, g.ended_at`,
    [tenantId, roundId],
  );
  const row = found.rows[0];
  if (!row?.signed_sha256 || !row.audit_sha256) {
    throw new Error(`Round ${roundId} has no completed evidence`);
  }
  return {
    facts: {
      eventId: roundId,
      tenantId,
      agreementId: row.agreement_id,
      revisionId: row.revision_id,
      roundId,
      completedAtMicros: Number(row.completed_micros),
      signedDocumentSha256: row.signed_sha256,
      auditRecordSha256: row.audit_sha256,
    },
    nowMicros: BigInt(row.now_micros),
  };
}
