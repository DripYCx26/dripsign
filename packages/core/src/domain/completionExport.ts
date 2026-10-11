// Completion export: the host's executed event for each completed round. Admins keep the public
// sender pins as immutable revisions; completion freezes one canonical body under the current
// revision; the worker signs and delivers that body until the host returns its receipt.
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config.ts";
import type { Db } from "../db.ts";
import { readTx, tx } from "../db.ts";
import { DomainError, notFound } from "../errors.ts";
import { executedEventBody } from "../host/event.ts";
import type { ExecutedFacts, ExecutedReceipt, FrozenExport } from "../host/event.ts";
import { enqueue, OUTBOX_CHANNEL } from "../jobs/outbox.ts";
import { completionExportSaveSchema, uuidSchema } from "../schema.ts";
import type { CompletionExportSave } from "../schema.ts";
import type {
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

/**
 * Archive seam, inside the completing transaction: freezes the round's executed event under the
 * tenant's current pins and queues its delivery. Off when delivery or the tenant's pins are unset.
 */
export async function exportCompletion(
  db: Db,
  facts: Omit<ExecutedFacts, "eventId">,
): Promise<void> {
  if (loadConfig().completionExport === null) return;
  const latest = await db.query<RevisionRow>(
    `SELECT ${REVISION_COLUMNS} FROM dripsign.completion_export_config
     WHERE tenant_id = $1 ORDER BY revision DESC LIMIT 1`,
    [facts.tenantId],
  );
  const row = latest.rows[0];
  if (row === undefined) return;
  const pins = toRevision(row);
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
    await requireRole(db, actor, ["admin"]);
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

async function undelivered(db: Db, tenantId: string): Promise<UndeliveredCompletion[]> {
  const found = await db.query<{
    roundId: string;
    agreementId: string;
    title: string;
    eventId: string;
    completedAt: Date;
    jobStatus: string | null;
  }>(
    `SELECT e.round_id AS "roundId", e.agreement_id AS "agreementId", a.title,
       e.event_id AS "eventId", e.created_at AS "completedAt",
       (SELECT o.status FROM dripsign.outbox o
        WHERE o.dedupe_key = 'host_event:' || e.round_id::text AND o.tenant_id = e.tenant_id)
         AS "jobStatus"
     FROM dripsign.completion_export e
     JOIN dripsign.agreement a ON a.tenant_id = e.tenant_id AND a.id = e.agreement_id
     WHERE e.tenant_id = $1 AND NOT EXISTS (
       SELECT 1 FROM dripsign.completion_delivery d
       WHERE d.tenant_id = e.tenant_id AND d.round_id = e.round_id)
     ORDER BY e.created_at DESC LIMIT $2`,
    [tenantId, UNDELIVERED_LIMIT],
  );
  return found.rows.map(({ jobStatus, completedAt, ...row }) => ({
    ...row,
    completedAt: iso(completedAt),
    state: jobStatus === "pending" || jobStatus === "running" ? "queued" : "failed",
  }));
}

/** Saves the next revision of the tenant's pins; returns its number. */
export async function saveCompletionExportConfig(
  actor: StaffActor,
  input: CompletionExportSave,
): Promise<number> {
  const { expectedRevision, config } = parseOrInvalid(completionExportSaveSchema, input);
  return tx(async (db) => {
    await requireRole(db, actor, ["admin"]);
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

/**
 * Queues the round's frozen event again after its delivery stopped. The body, event id and key
 * pins stay as frozen; a delivered event is left alone.
 */
export async function recoverCompletionExport(actor: StaffActor, roundId: string): Promise<void> {
  const round = parseOrInvalid(uuidSchema, roundId);
  if (loadConfig().completionExport === null) {
    throw new DomainError("invalid", "Completion export delivery is off on this server.");
  }
  return tx(async (db) => {
    await requireRole(db, actor, ["admin"]);
    const found = await db.query<{ agreementId: string; delivered: boolean }>(
      `SELECT e.agreement_id AS "agreementId", d.round_id IS NOT NULL AS delivered
       FROM dripsign.completion_export e
       LEFT JOIN dripsign.completion_delivery d
         ON d.tenant_id = e.tenant_id AND d.round_id = e.round_id
       WHERE e.tenant_id = $1 AND e.round_id = $2`,
      [actor.tenantId, round],
    );
    const exported = found.rows[0];
    if (exported === undefined) throw notFound();
    if (exported.delivered) return;
    const job = await db.query<{ status: string }>(
      `SELECT status FROM dripsign.outbox WHERE dedupe_key = $1 AND tenant_id = $2 FOR UPDATE`,
      [hostEventKey(round), actor.tenantId],
    );
    const status = job.rows[0]?.status;
    if (status === "running") throw conflict("A delivery attempt is running now.");
    if (status === undefined) {
      // Retention swept the failed job; the dedupe key is free again.
      await enqueue(db, {
        tenantId: actor.tenantId,
        agreementId: exported.agreementId,
        dedupeKey: hostEventKey(round),
        payload: { kind: "host_event", roundId: round },
      });
      return;
    }
    await db.query(
      `UPDATE dripsign.outbox
       SET status = 'pending', attempts = 0, available_at = now(), finished_at = NULL,
           last_error = NULL
       WHERE dedupe_key = $1 AND tenant_id = $2`,
      [hostEventKey(round), actor.tenantId],
    );
    await db.query("SELECT pg_notify($1, 'host_event')", [OUTBOX_CHANNEL]);
  });
}
