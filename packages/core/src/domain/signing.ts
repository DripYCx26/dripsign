// Signing rounds: request, cancel and sign. The archive seam lives in archive.ts and is
// re-exported here, where the worker imports it.
import { randomUUID } from "node:crypto";
import { SIGNING_VERIFICATION_MAX_AGE_MS } from "../auth/sessions.ts";
import type { Db } from "../db.ts";
import { DomainError } from "../errors.ts";
import { enqueue } from "../jobs/outbox.ts";
import { LIMITS, SIGNING_CONSENT } from "../schema.ts";
import type { CommandOf } from "../schema.ts";
import type { RoundEndReason } from "../types.ts";
import { markInvited, notify } from "./notify.ts";
import type { Addressee } from "./notify.ts";
import { conflict } from "./state.ts";
import type { AgreementRow, CommandContext, LiveRound } from "./state.ts";

export { completeArchive, loadArchiveEvidence } from "./archive.ts";
export type { ArchiveCompletion, ArchiveOutcome } from "./archive.ts";

/** Freezes the current revision's hash, its signer set and the consent text in a new round. */
export async function requestSignatures(ctx: CommandContext): Promise<void> {
  const { db, agreement, actor } = ctx;
  const roundId = randomUUID();
  const created = await db.query<{ signerCount: number }>(
    `INSERT INTO dripsign.signing_round (
       tenant_id, agreement_id, id, revision_id, document_sha256,
       consent_version, consent_text, consent_hash, requested_by
     )
     SELECT tenant_id, agreement_id, $3, id, document_sha256, $4, $5, $6, $7
     FROM dripsign.revision WHERE tenant_id = $1 AND agreement_id = $2 AND id = $8
     RETURNING (SELECT cardinality(signer_ids) FROM dripsign.revision
                WHERE tenant_id = $1 AND id = $8) AS "signerCount"`,
    [
      agreement.tenantId,
      agreement.id,
      roundId,
      SIGNING_CONSENT.version,
      SIGNING_CONSENT.text,
      SIGNING_CONSENT.sha256,
      actor.email,
      agreement.currentRevisionId,
    ],
  );
  const signerCount = created.rows[0]?.signerCount;
  if (signerCount === undefined) throw conflict();
  // Signers come from the revision; a removed one would leave the frozen set short.
  const frozen = await db.query<Addressee>(
    `INSERT INTO dripsign.round_signer (tenant_id, agreement_id, round_id, recipient_id, name, email)
     SELECT r.tenant_id, r.agreement_id, $3, r.id, r.name, r.email
     FROM dripsign.revision v
     JOIN dripsign.recipient r
       ON r.tenant_id = v.tenant_id AND r.agreement_id = v.agreement_id
      AND r.id = ANY(v.signer_ids) AND r.revoked_at IS NULL
     WHERE v.tenant_id = $1 AND v.agreement_id = $2 AND v.id = $4
     RETURNING recipient_id AS id, email`,
    [agreement.tenantId, agreement.id, roundId, agreement.currentRevisionId],
  );
  if (frozen.rows.length !== signerCount) {
    throw conflict("Required signers changed. Publish again before requesting signatures.");
  }
  await setStatus(db, agreement, "signing");
  await notify(db, { agreement, template: "sign_request", to: frozen.rows, resourceId: roundId });
  await markInvited(
    db,
    agreement.tenantId,
    frozen.rows.map((signer) => signer.id),
  );
}

export async function cancelSignatures(
  ctx: CommandContext,
  command: CommandOf<"cancel_signatures">,
): Promise<void> {
  const round = ctx.state.round;
  if (round?.id !== command.roundId) throw conflict();
  await endRound(ctx, { round, reason: "cancelled", causedBy: null });
}

/**
 * Voids the active round (its signatures stay as evidence), returns the agreement to negotiation
 * and tells the other frozen signers.
 */
export async function endRound(
  ctx: CommandContext,
  end: {
    readonly round: LiveRound;
    readonly reason: RoundEndReason;
    readonly causedBy: string | null;
  },
): Promise<void> {
  const { db, agreement } = ctx;
  await voidRound(db, agreement, end.round, end.reason);
  await setStatus(db, agreement, "negotiating");
  const signers = await db.query<Addressee>(
    `SELECT recipient_id AS id, email FROM dripsign.round_signer
     WHERE tenant_id = $1 AND round_id = $2 AND recipient_id IS DISTINCT FROM $3
     ORDER BY recipient_id`,
    [agreement.tenantId, end.round.id, end.causedBy],
  );
  await notify(db, {
    agreement,
    template: "signing_cancelled",
    to: signers.rows,
    resourceId: end.round.id,
  });
}

/** Nothing voids a finalizing round; the state machine trigger refuses it as well. */
export async function voidRound(
  db: Db,
  agreement: AgreementRow,
  round: LiveRound,
  reason: RoundEndReason,
): Promise<void> {
  if (round.status !== "active") throw conflict();
  await db.query(
    `UPDATE dripsign.signing_round SET status = 'void', ended_at = now(), end_reason = $3
     WHERE tenant_id = $1 AND id = $2`,
    [agreement.tenantId, round.id, reason],
  );
}

async function setStatus(
  db: Db,
  agreement: AgreementRow,
  status: "negotiating" | "signing",
): Promise<void> {
  await db.query("UPDATE dripsign.agreement SET status = $3 WHERE tenant_id = $1 AND id = $2", [
    agreement.tenantId,
    agreement.id,
    status,
  ]);
}

/**
 * Binds the frozen round, revision and hash, a fresh verification, the verbatim consent and the
 * request evidence (cut to its stored bounds, never refused). Times are clock_timestamp(), read
 * after every lock wait, never the transaction start: a verification refreshed while this command
 * queued still precedes its signature, and every signature precedes finalizing (the triggers
 * refuse anything else).
 */
export async function sign(ctx: CommandContext, command: CommandOf<"sign">): Promise<void> {
  const { db, agreement, actor } = ctx;
  const round = assertSigningFence(ctx, command);
  const bounds = LIMITS.requestEvidence;
  // signed_at defaults to clock_timestamp(), after the session row this statement reads.
  const signed = await db.query(
    `INSERT INTO dripsign.signature (
       tenant_id, agreement_id, round_id, recipient_id, typed_name, consent_version,
       consent_text, consent_hash, document_sha256, session_id, verified_at, ip_address, user_agent
     )
     SELECT g.tenant_id, g.agreement_id, g.id, $3, $4, g.consent_version, g.consent_text,
       g.consent_hash, g.document_sha256, s.id, s.verified_at, left($7, $10), left($8, $11)
     FROM dripsign.signing_round g
     JOIN dripsign.auth_session s
       ON s.id = $5 AND s.email = $6 AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
      AND s.verified_at > clock_timestamp() - $9::float8 * interval '1 millisecond'
     WHERE g.tenant_id = $1 AND g.id = $2`,
    [
      agreement.tenantId,
      round.id,
      ctx.state.viewer.recipientId,
      command.typedName,
      actor.sessionId,
      actor.email,
      actor.request?.ipAddress ?? null,
      actor.request?.userAgent ?? null,
      SIGNING_VERIFICATION_MAX_AGE_MS,
      bounds.ipAddress,
      bounds.userAgent,
    ],
  );
  // The session row, not the cached actor, proves a verification within the signing window.
  if (signed.rowCount !== 1) {
    throw new DomainError("verification_required", "Confirm it’s you before signing.");
  }
  const complete = await db.query<{ complete: boolean }>(
    "SELECT NOT dripsign.round_missing_signatures($1, $2) AS complete",
    [agreement.tenantId, round.id],
  );
  if (complete.rows[0]?.complete === true) {
    // The last signature and the archive job commit together, so a signed round always archives.
    await db.query(
      `UPDATE dripsign.signing_round SET status = 'finalizing', finalizing_at = clock_timestamp()
       WHERE tenant_id = $1 AND id = $2`,
      [agreement.tenantId, round.id],
    );
    await enqueue(db, {
      tenantId: agreement.tenantId,
      agreementId: agreement.id,
      dedupeKey: `archive:${round.id}`,
      payload: { kind: "archive", roundId: round.id },
    });
  }
}

function assertSigningFence(ctx: CommandContext, command: CommandOf<"sign">): LiveRound {
  const round = ctx.state.round;
  const current =
    round?.status === "active" &&
    round.id === command.roundId &&
    round.revisionId === command.revisionId &&
    ctx.agreement.currentRevisionId === command.revisionId &&
    round.documentSha256 === command.documentSha256;
  if (!current) throw conflict("This document changed while you were signing.");
  if (
    round.consentVersion !== command.consentVersion ||
    round.consentHash !== command.consentHash
  ) {
    throw conflict("The signing terms changed. Review them again before signing.");
  }
  return round;
}
