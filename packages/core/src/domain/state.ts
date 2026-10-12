// Shared plumbing for domain commands and views: access, the agreement row lock, the policy
// snapshot loaded after the lock, and the small helpers every command uses.
import pg from "pg";
import type { z } from "zod";
import { loadConfig } from "../config.ts";
import type { Db } from "../db.ts";
import { pgConstraint, pgErrorCode, tx } from "../db.ts";
import { DomainError, notFound } from "../errors.ts";
import { uuidSchema } from "../schema.ts";
import type { Draft } from "../schema.ts";
import type { Actor, AgreementAction, AgreementStatus, Capacity } from "../types.ts";
import { allowedActions, STAFF_ONLY_ACTIONS } from "./policy.ts";
import type { PolicySnapshot, PolicyViewer } from "./policy.ts";

export interface Access {
  readonly tenantId: string;
  readonly orgName: string;
}

/** `agreement.draft` is only written through `draftSchema.parse`, so reads trust its shape. */
export interface AgreementRow {
  readonly tenantId: string;
  readonly id: string;
  readonly title: string;
  readonly status: AgreementStatus;
  readonly version: number;
  readonly currentRevisionId: string | null;
  readonly draft: Draft;
  readonly draftDirty: boolean;
  readonly draftVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly voidedAt: Date | null;
  readonly voidReason: string | null;
}

export interface LiveSigner {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface LiveRound {
  readonly id: string;
  readonly status: "active" | "finalizing";
  readonly revisionId: string;
  readonly documentSha256: string;
  readonly consentVersion: string;
  readonly consentHash: string;
}

export interface AgreementState {
  readonly agreement: AgreementRow;
  /** Live required signers in signature-page order. */
  readonly signers: readonly LiveSigner[];
  readonly pending: { readonly id: string; readonly by: Capacity } | null;
  readonly round: LiveRound | null;
  readonly viewer: PolicyViewer & { readonly recipientId: string | null };
  readonly snapshot: PolicySnapshot;
}

export interface CommandContext {
  readonly db: Db;
  readonly actor: Actor;
  readonly access: Access;
  /** Locked for the transaction, as read before the shared fence moved its version. */
  readonly agreement: AgreementRow;
  readonly state: AgreementState;
}

export const AGREEMENT_COLUMNS = `tenant_id AS "tenantId", id, title, status, version,
  current_revision_id AS "currentRevisionId", draft, draft_dirty AS "draftDirty",
  draft_version AS "draftVersion", created_at AS "createdAt", updated_at AS "updatedAt", voided_at AS "voidedAt",
  void_reason AS "voidReason"`;

/**
 * The one signer order ($1 tenant, $2 agreement): the signature page, the staged draft, its fence
 * hash and the publish check all read it, so none can disagree with another.
 */
const LIVE_SIGNERS = `SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name,
    'email', email) ORDER BY added_at, id), '[]'::jsonb)
  FROM dripsign.recipient
  WHERE tenant_id = $1 AND agreement_id = $2 AND is_signer AND revoked_at IS NULL`;

export async function liveSigners(
  db: Db,
  tenantId: string,
  agreementId: string,
): Promise<LiveSigner[]> {
  const found = await db.query<{ signers: LiveSigner[] }>(`SELECT (${LIVE_SIGNERS}) AS signers`, [
    tenantId,
    agreementId,
  ]);
  return found.rows[0]?.signers ?? [];
}

const STALE_MESSAGE = "This agreement changed. Reload to see the latest.";

export function conflict(message = STALE_MESSAGE): DomainError {
  return new DomainError("conflict", message);
}

/** Resolves the actor's live standing on the agreement from the database; anything else is not_found. */
export async function resolveAccess(db: Db, actor: Actor, agreementId: string): Promise<Access> {
  if (!uuidSchema.safeParse(agreementId).success) throw notFound();
  const found = await db.query<{
    tenantId: string;
    orgName: string;
    published: boolean;
    staff: boolean;
    recipient: boolean;
  }>(
    `SELECT a.tenant_id AS "tenantId", t.name AS "orgName",
       a.current_revision_id IS NOT NULL AS published,
       EXISTS (SELECT 1 FROM dripsign.staff s
               WHERE s.tenant_id = a.tenant_id AND s.email = $2 AND s.revoked_at IS NULL) AS staff,
       EXISTS (SELECT 1 FROM dripsign.recipient r
               WHERE r.tenant_id = a.tenant_id AND r.agreement_id = a.id AND r.email = $2
                 AND r.revoked_at IS NULL) AS recipient
     FROM dripsign.agreement a
     JOIN dripsign.tenant t ON t.id = a.tenant_id
     WHERE a.id = $1`,
    [agreementId, actor.email],
  );
  const row = found.rows[0];
  if (row === undefined) throw notFound();
  const allowed =
    actor.capacity === "staff"
      ? row.staff && row.tenantId === actor.tenantId
      : row.recipient && row.published;
  if (!allowed) throw notFound();
  return { tenantId: row.tenantId, orgName: row.orgName };
}

/**
 * Rechecks the actor's grant after a command's lock waits and holds the row FOR SHARE until
 * commit: a revocation that committed while the command queued is seen here, and one that starts
 * later waits for this commit. Lock order: receipt, agreement row, grant row, job rows.
 */
export async function lockGrant(
  db: Db,
  actor: Actor,
  scope: { readonly tenantId: string; readonly agreementId: string | null },
): Promise<void> {
  const found =
    actor.capacity === "staff"
      ? await db.query(
          `SELECT 1 FROM dripsign.staff
           WHERE tenant_id = $1 AND email = $2 AND revoked_at IS NULL
           FOR SHARE`,
          [scope.tenantId, actor.email],
        )
      : await db.query(
          `SELECT 1 FROM dripsign.recipient
           WHERE tenant_id = $1 AND agreement_id = $2 AND email = $3 AND revoked_at IS NULL
           FOR SHARE`,
          [scope.tenantId, scope.agreementId, actor.email],
        );
  if (found.rowCount !== 1) throw notFound();
}

/** `shared` is `agreement.version`, which recipients see; `draft` is the staff-private draft's. */
export interface Fence {
  readonly on: "shared" | "draft";
  readonly expected: number;
}

export async function lockAgreement(
  db: Db,
  tenantId: string,
  agreementId: string,
): Promise<AgreementRow> {
  const locked = await db.query<AgreementRow>(
    `SELECT ${AGREEMENT_COLUMNS} FROM dripsign.agreement
     WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenantId, agreementId],
  );
  const row = locked.rows[0];
  if (row === undefined) throw notFound();
  return row;
}

/**
 * A stale expected version is a conflict. Runs after `requireAction`, so a recipient's staff-only
 * command never learns the private draft version. The shared fence moves the version and the list
 * order on; the draft fence is only checked here, because every change to the terms moves it (see
 * `stageDraft`).
 */
export async function checkFence(
  db: Db,
  agreement: AgreementRow,
  fence: Fence | null,
): Promise<void> {
  if (fence === null) return;
  if (fence.on === "draft") {
    if (agreement.draftVersion !== fence.expected) throw conflict();
    return;
  }
  const moved = await db.query(
    `UPDATE dripsign.agreement SET version = version + 1, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND version = $3`,
    [agreement.tenantId, agreement.id, fence.expected],
  );
  if (moved.rowCount !== 1) throw conflict();
}

export async function readAgreement(
  db: Db,
  tenantId: string,
  agreementId: string,
): Promise<AgreementRow> {
  const found = await db.query<AgreementRow>(
    `SELECT ${AGREEMENT_COLUMNS} FROM dripsign.agreement WHERE tenant_id = $1 AND id = $2`,
    [tenantId, agreementId],
  );
  const row = found.rows[0];
  if (row === undefined) throw notFound();
  return row;
}

interface StateRow {
  pending: { id: string; by: Capacity; email: string } | null;
  round: LiveRound | null;
  signers: LiveSigner[];
  readyAi: number;
  aiTurnPending: boolean;
  viewerId: string | null;
  viewerIsRoundSigner: boolean;
  viewerHasSigned: boolean;
}

/** Everything the policy needs, in one statement; run it after the lock in commands. */
export async function loadState(
  db: Db,
  agreement: AgreementRow,
  actor: Actor,
): Promise<AgreementState> {
  const viewerEmail = actor.capacity === "recipient" ? actor.email : null;
  const loaded = await db.query<StateRow>(
    `WITH live_round AS (
       SELECT id, status, revision_id, document_sha256, consent_version, consent_hash
       FROM dripsign.signing_round
       WHERE tenant_id = $1 AND agreement_id = $2 AND status IN ('active', 'finalizing')
     ), viewer AS (
       SELECT id FROM dripsign.recipient
       WHERE tenant_id = $1 AND agreement_id = $2 AND email = $3 AND revoked_at IS NULL
     )
     SELECT
       (SELECT jsonb_build_object('id', id, 'by', author_capacity, 'email', author_email)
        FROM dripsign.proposal
        WHERE tenant_id = $1 AND agreement_id = $2 AND status = 'pending') AS pending,
       (SELECT jsonb_build_object('id', id, 'status', status, 'revisionId', revision_id,
          'documentSha256', document_sha256, 'consentVersion', consent_version,
          'consentHash', consent_hash) FROM live_round) AS round,
       (${LIVE_SIGNERS}) AS signers,
       (SELECT count(*)::int FROM dripsign.ai_suggestion
        WHERE tenant_id = $1 AND agreement_id = $2 AND status = 'ready' AND mode = 'draft')
         AS "readyAi",
       EXISTS (SELECT 1 FROM dripsign.ai_suggestion
               WHERE tenant_id = $1 AND agreement_id = $2 AND status = 'queued')
         AS "aiTurnPending",
       (SELECT id FROM viewer) AS "viewerId",
       EXISTS (SELECT 1 FROM dripsign.round_signer rs JOIN live_round g ON g.id = rs.round_id
               WHERE rs.tenant_id = $1 AND rs.recipient_id = (SELECT id FROM viewer))
         AS "viewerIsRoundSigner",
       EXISTS (SELECT 1 FROM dripsign.signature s JOIN live_round g ON g.id = s.round_id
               WHERE s.tenant_id = $1 AND s.recipient_id = (SELECT id FROM viewer))
         AS "viewerHasSigned"`,
    [agreement.tenantId, agreement.id, viewerEmail],
  );
  const row = loaded.rows[0];
  if (row === undefined) throw new Error("State query returned no row");
  const pending = row.pending;
  return {
    agreement,
    signers: row.signers,
    pending,
    round: row.round,
    viewer: {
      recipientId: row.viewerId,
      isRequiredSigner: row.viewerIsRoundSigner,
      hasSigned: row.viewerHasSigned,
      ownsPendingProposal:
        pending?.by === actor.capacity &&
        (actor.capacity === "staff" || pending.email === actor.email),
    },
    snapshot: {
      status: agreement.status,
      hasRevision: agreement.currentRevisionId !== null,
      publicationNeeded: agreement.draftDirty,
      preparation: agreement.draft.preparation.status,
      draftSignerCount: row.signers.length,
      pendingProposalBy: row.pending?.by ?? null,
      round: row.round?.status ?? null,
      aiEnabled: loadConfig().ai !== null,
      readyAiSuggestions: row.readyAi,
      aiTurnPending: row.aiTurnPending,
    },
  };
}

export function actionsFor(state: AgreementState, capacity: Capacity): AgreementAction[] {
  return allowedActions(state.snapshot, capacity, state.viewer);
}

/** The policy recheck after `lockGrant`. Staff-only actions are invisible to recipients. */
export function requireAction(
  state: AgreementState,
  capacity: Capacity,
  action: AgreementAction,
): void {
  if (actionsFor(state, capacity).includes(action)) return;
  if (capacity === "recipient" && STAFF_ONLY_ACTIONS.includes(action)) throw notFound();
  throw conflict("This action isn’t available now. Reload to see the latest.");
}

/** Records activity on the list order; `bumpVersion` for unfenced commands that change state. */
export async function touchAgreement(
  db: Db,
  agreement: AgreementRow,
  bumpVersion: boolean,
): Promise<void> {
  await db.query(
    `UPDATE dripsign.agreement
     SET updated_at = now(), version = version + CASE WHEN $3 THEN 1 ELSE 0 END
     WHERE tenant_id = $1 AND id = $2`,
    [agreement.tenantId, agreement.id, bumpVersion],
  );
}

/**
 * Worker seams take a pool, in which case they open their own transaction, or the client of the
 * caller's open transaction, which they join.
 */
export function withinTx<T>(db: Db, fn: (db: Db) => Promise<T>): Promise<T> {
  return db instanceof pg.Pool ? tx(fn, db) : fn(db);
}

export function parseOrInvalid<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new DomainError("invalid", parsed.error.issues[0]?.message ?? "The request is invalid.");
}

/** Runs one insert or update, turning a violation of the named unique index into a conflict. */
export async function uniqueOrConflict<T>(
  constraint: string,
  message: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error: unknown) {
    if (pgErrorCode(error) === "23505" && pgConstraint(error) === constraint) {
      throw new DomainError("conflict", message, { cause: error });
    }
    throw error;
  }
}

export function iso(value: Date): string {
  return value.toISOString();
}

export function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}
