// Completion export: the host's executed event for each completed round. Admins keep the public
// sender pins as immutable revisions; completion freezes one canonical body under the current
// revision when this server can deliver it (else an admin freezes it later through recover); the
// worker signs and delivers that body until the host returns its receipt.
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.ts";
import type { CompletionExportDelivery } from "../config.ts";
import type { Db } from "../db.ts";
import { readTx, tx } from "../db.ts";
import { DomainError, notFound } from "../errors.ts";
import { executedEventBody, undeliverableReason } from "../host/event.ts";
import type { ExecutedFacts, ExecutedReceipt, FrozenExport } from "../host/event.ts";
import { enqueue, OUTBOX_CHANNEL } from "../jobs/outbox.ts";
import { completionExportSaveSchema, uuidSchema } from "../schema.ts";
import type { CompletionExportSave } from "../schema.ts";
import type {
  CompletionDeliveryState,
  CompletionExportRevision,
  CompletionExportSettings,
  StaffActor,
  UndeliveredCompletion,
} from "../types.ts";
import { requireRole } from "./staff.ts";
import { conflict, iso, parseOrInvalid, uniqueOrConflict } from "./state.ts";

const HISTORY_LIMIT = 20;
const UNDELIVERED_LIMIT = 50;
const STALE_SETTINGS = "These settings changed. Reload to see the latest.";

// pg returns bigint as text; float8 is exact for the integers the schema admits (below 2^53).
const REVISION_COLUMNS = `revision, host_tenant_id AS "hostTenantId",
  sender_binding_id AS "senderBindingId",
  sender_binding_revision::float8 AS "senderBindingRevision",
  sender_grant_id AS "senderGrantId", issuer, audience, key_id AS "keyId",
  key_version::float8 AS "keyVersion", freshness_seconds AS "freshnessSeconds",
  created_by AS "createdBy", created_at AS "createdAt"`;

interface RevisionRow {
  revision: number;
  hostTenantId: string;
  senderBindingId: string;
  senderBindingRevision: number;
  senderGrantId: string;
  issuer: string;
  audience: string;
  keyId: string;
  keyVersion: number;
  freshnessSeconds: number;
  createdBy: string;
  createdAt: Date;
}

function toRevision(row: RevisionRow): CompletionExportRevision {
  const { revision, createdBy, createdAt, ...config } = row;
  return { revision, config, createdBy, createdAt: iso(createdAt) };
}

function hostEventKey(roundId: string): string {
  return `host_event:${roundId}`;
}

async function currentPins(db: Db, tenantId: string): Promise<CompletionExportRevision | null> {
  const latest = await db.query<RevisionRow>(
    `SELECT ${REVISION_COLUMNS} FROM dripsign.completion_export_config
     WHERE tenant_id = $1 ORDER BY revision DESC LIMIT 1`,
    [tenantId],
  );
  const row = latest.rows[0];
  return row === undefined ? null : toRevision(row);
}

/** Freezes the round's executed event under these pins and queues its delivery. */
async function freeze(
  db: Db,
  pins: CompletionExportRevision,
  facts: Omit<ExecutedFacts, "eventId">,
): Promise<void> {
  const eventId = randomUUID();
  const body = executedEventBody(pins.config, { ...facts, eventId });
  await db.query(
    `INSERT INTO dripsign.completion_export
       (tenant_id, agreement_id, round_id, event_id, config_revision, body, freshness_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      facts.tenantId,
      facts.agreementId,
      facts.roundId,
      eventId,
      pins.revision,
      body,
      pins.config.freshnessSeconds,
    ],
  );
  await enqueue(db, {
    tenantId: facts.tenantId,
    agreementId: facts.agreementId,
    dedupeKey: hostEventKey(facts.roundId),
    payload: { kind: "host_event", roundId: facts.roundId },
  });
}

/**
 * Archive seam, inside the completing transaction: freezes the round's executed event under the
 * tenant's current pins and queues its delivery. Off when delivery or the tenant's pins are unset.
 * Pins this server could never deliver (saved while delivery was off) freeze nothing: the round
 * waits, listed as undelivered, until an admin fixes them and recovers it.
 */
export async function exportCompletion(
  db: Db,
  facts: Omit<ExecutedFacts, "eventId">,
): Promise<void> {
  const delivery = loadConfig().completionExport;
  if (delivery === null) return;
  const pins = await currentPins(db, facts.tenantId);
  if (pins === null) return;
  if (undeliverableReason(pins.config, delivery) !== null) {
    console.error("dripsign: completion export held", { id: facts.roundId, code: "undeliverable" });
    return;
  }
  await freeze(db, pins, facts);
}

/** Worker seam: the frozen body, with the database clock so issue never precedes completion. */
export async function loadCompletionExport(
  db: Db,
  input: { readonly tenantId: string; readonly roundId: string },
): Promise<FrozenExport | null> {
  const found = await db.query<{ body: string; freshnessSeconds: number; nowMicros: string }>(
    `SELECT body, freshness_seconds AS "freshnessSeconds",
       (extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text AS "nowMicros"
     FROM dripsign.completion_export WHERE tenant_id = $1 AND round_id = $2`,
    [input.tenantId, input.roundId],
  );
  const row = found.rows[0];
  return row ? { ...row, nowMicros: BigInt(row.nowMicros) } : null;
}

/** Worker seam: records the host's receipt once; a repeated delivery keeps the first. */
export async function recordCompletionDelivery(
  db: Db,
  input: { readonly tenantId: string; readonly roundId: string; readonly receipt: ExecutedReceipt },
): Promise<void> {
  await db.query(
    `INSERT INTO dripsign.completion_delivery
       (tenant_id, round_id, evidence_id, recorded_at_micros)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, round_id) DO NOTHING`,
    [input.tenantId, input.roundId, input.receipt.evidenceId, input.receipt.recordedAtMicros],
  );
}

export function readCompletionExportSettings(actor: StaffActor): Promise<CompletionExportSettings> {
  const config = loadConfig();
  return readTx(async (db) => {
    await requireRole(db, actor, ["admin"], "read");
    const history = await db.query<RevisionRow>(
      `SELECT ${REVISION_COLUMNS} FROM dripsign.completion_export_config
       WHERE tenant_id = $1 ORDER BY revision DESC LIMIT $2`,
      [actor.tenantId, HISTORY_LIMIT],
    );
    const revisions = history.rows.map(toRevision);
    return {
      deliveryEnabled: config.completionExport !== null,
      expected: {
        issuer: config.publicOrigin,
        audience: config.completionExport ? new URL(config.completionExport.url).origin : null,
      },
      current: revisions[0] ?? null,
      history: revisions,
      undelivered: await undelivered(db, actor.tenantId),
    };
  });
}

/**
 * Completed rounds the host has not acknowledged: frozen events still sending or stopped, and
 * rounds that completed under pins this server could not deliver, so nothing was frozen.
 */
async function undelivered(db: Db, tenantId: string): Promise<UndeliveredCompletion[]> {
  const found = await db.query<{
    roundId: string;
    agreementId: string;
    title: string;
    eventId: string | null;
    completedAt: Date;
    jobStatus: string | null;
  }>(
    `SELECT g.id AS "roundId", g.agreement_id AS "agreementId", a.title,
       e.event_id AS "eventId", g.ended_at AS "completedAt",
       (SELECT o.status FROM dripsign.outbox o
        WHERE o.dedupe_key = 'host_event:' || g.id::text AND o.tenant_id = g.tenant_id)
         AS "jobStatus"
     FROM dripsign.signing_round g
     JOIN dripsign.agreement a ON a.tenant_id = g.tenant_id AND a.id = g.agreement_id
     LEFT JOIN dripsign.completion_export e ON e.tenant_id = g.tenant_id AND e.round_id = g.id
     WHERE g.tenant_id = $1 AND g.status = 'completed'
       AND NOT EXISTS (
         SELECT 1 FROM dripsign.completion_delivery d
         WHERE d.tenant_id = g.tenant_id AND d.round_id = g.id)
       AND (e.round_id IS NOT NULL OR EXISTS (
         SELECT 1 FROM dripsign.completion_export_config c
         WHERE c.tenant_id = g.tenant_id AND c.created_at <= g.ended_at))
     ORDER BY g.ended_at DESC LIMIT $2`,
    [tenantId, UNDELIVERED_LIMIT],
  );
  return found.rows.map(({ jobStatus, completedAt, ...row }) => ({
    ...row,
    completedAt: iso(completedAt),
    state: deliveryState(row.eventId, jobStatus),
  }));
}

function deliveryState(eventId: string | null, jobStatus: string | null): CompletionDeliveryState {
  if (eventId === null) return "held";
  return jobStatus === "pending" || jobStatus === "running" ? "queued" : "failed";
}

/** Saves the next revision of the tenant's pins; returns its number. */
export async function saveCompletionExportConfig(
  actor: StaffActor,
  input: CompletionExportSave,
): Promise<number> {
  const { expectedRevision, config } = parseOrInvalid(completionExportSaveSchema, input);
  return tx(async (db) => {
    await requireRole(db, actor, ["admin"], "write");
    // While delivery is off nothing freezes, so any pins save; freezing checks them again.
    const delivery = loadConfig().completionExport;
    const refusal = delivery === null ? null : undeliverableReason(config, delivery);
    if (refusal !== null) throw new DomainError("invalid", refusal);
    const latest = await db.query<{ revision: number }>(
      `SELECT coalesce(max(revision), 0) AS revision FROM dripsign.completion_export_config
       WHERE tenant_id = $1`,
      [actor.tenantId],
    );
    if (latest.rows[0]?.revision !== expectedRevision) throw conflict(STALE_SETTINGS);
    const revision = expectedRevision + 1;
    await uniqueOrConflict("completion_export_config_pkey", STALE_SETTINGS, () =>
      db.query(
        `INSERT INTO dripsign.completion_export_config
           (tenant_id, revision, host_tenant_id, sender_binding_id, sender_binding_revision,
            sender_grant_id, issuer, audience, key_id, key_version, freshness_seconds, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          actor.tenantId,
          revision,
          config.hostTenantId,
          config.senderBindingId,
          config.senderBindingRevision,
          config.senderGrantId,
          config.issuer,
          config.audience,
          config.keyId,
          config.keyVersion,
          config.freshnessSeconds,
          actor.email,
        ],
      ),
    );
    return revision;
  });
}

interface RoundRow {
  agreementId: string;
  revisionId: string;
  completedMicros: string;
  signedDocumentSha256: string;
  auditRecordSha256: string;
}

/**
 * Sends a completed round's event again: freezes it first when completion held it back (its pins
 * were undeliverable then), else queues the frozen body again after its delivery stopped. A frozen
 * body, event id and key pins never change; a delivered event is left alone.
 */
export async function recoverCompletionExport(actor: StaffActor, roundId: string): Promise<void> {
  const round = parseOrInvalid(uuidSchema, roundId);
  const delivery = loadConfig().completionExport;
  if (delivery === null) {
    throw new DomainError("invalid", "Completion export delivery is off on this server.");
  }
  return tx(async (db) => {
    // The round row lock serialises two admins recovering the same round; authority is checked
    // after its wait.
    const found = await db.query<RoundRow>(
      `SELECT g.agreement_id AS "agreementId", g.revision_id AS "revisionId",
         (extract(epoch FROM g.ended_at) * 1000000)::bigint::text AS "completedMicros",
         (SELECT f.sha256 FROM dripsign.artifact f WHERE f.tenant_id = g.tenant_id
            AND f.round_id = g.id AND f.kind = 'signed_document') AS "signedDocumentSha256",
         (SELECT f.sha256 FROM dripsign.artifact f WHERE f.tenant_id = g.tenant_id
            AND f.round_id = g.id AND f.kind = 'audit_record') AS "auditRecordSha256"
       FROM dripsign.signing_round g
       WHERE g.tenant_id = $1 AND g.id = $2 AND g.status = 'completed'
       FOR UPDATE`,
      [actor.tenantId, round],
    );
    await requireRole(db, actor, ["admin"], "write");
    const completed = found.rows[0];
    if (completed === undefined) throw notFound();
    // A new statement after the lock sees what the admin who held it committed.
    const sent = await db.query<{ exported: boolean; delivered: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM dripsign.completion_export
                      WHERE tenant_id = $1 AND round_id = $2) AS exported,
              EXISTS (SELECT 1 FROM dripsign.completion_delivery
                      WHERE tenant_id = $1 AND round_id = $2) AS delivered`,
      [actor.tenantId, round],
    );
    const state = sent.rows[0];
    if (state?.delivered === true) return;
    if (state?.exported !== true) {
      await freezeHeld(db, delivery, { tenantId: actor.tenantId, roundId: round, ...completed });
      return;
    }
    await requeue(db, actor.tenantId, completed.agreementId, round);
  });
}

/** Freezes a round completion held back, once the current pins are deliverable. */
async function freezeHeld(
  db: Db,
  delivery: CompletionExportDelivery,
  round: RoundRow & { readonly tenantId: string; readonly roundId: string },
): Promise<void> {
  const pins = await currentPins(db, round.tenantId);
  if (pins === null) throw new DomainError("invalid", "Save the host’s settings first.");
  const refusal = undeliverableReason(pins.config, delivery);
  if (refusal !== null) throw new DomainError("invalid", refusal);
  await freeze(db, pins, {
    tenantId: round.tenantId,
    agreementId: round.agreementId,
    roundId: round.roundId,
    revisionId: round.revisionId,
    completedAtMicros: Number(round.completedMicros),
    signedDocumentSha256: round.signedDocumentSha256,
    auditRecordSha256: round.auditRecordSha256,
  });
}

/** Queues a frozen event again after its delivery stopped. */
async function requeue(
  db: Db,
  tenantId: string,
  agreementId: string,
  roundId: string,
): Promise<void> {
  const job = await db.query<{ status: string }>(
    `SELECT status FROM dripsign.outbox WHERE dedupe_key = $1 AND tenant_id = $2 FOR UPDATE`,
    [hostEventKey(roundId), tenantId],
  );
  const status = job.rows[0]?.status;
  if (status === "running") throw conflict("A delivery attempt is running now.");
  if (status === undefined) {
    // Retention swept the failed job; the dedupe key is free again.
    await enqueue(db, {
      tenantId,
      agreementId,
      dedupeKey: hostEventKey(roundId),
      payload: { kind: "host_event", roundId },
    });
    return;
  }
  await db.query(
    `UPDATE dripsign.outbox
     SET status = 'pending', attempts = 0, available_at = now(), finished_at = NULL,
         last_error = NULL
     WHERE dedupe_key = $1 AND tenant_id = $2`,
    [hostEventKey(roundId), tenantId],
  );
  await db.query("SELECT pg_notify($1, 'host_event')", [OUTBOX_CHANNEL]);
}
