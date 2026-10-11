// Recipient management: add, remove, required-signer flag and invitation resends.
import { randomUUID } from "node:crypto";
import { DomainError, notFound } from "../errors.ts";
import { LIMITS } from "../schema.ts";
import type { CommandOf } from "../schema.ts";
import { markInvited, notify } from "./notify.ts";
import { restageForSigners } from "./revisions.ts";
import { endRound } from "./signing.ts";
import { conflict, uniqueOrConflict } from "./state.ts";
import type { CommandContext, LiveSigner } from "./state.ts";

/** One invitation resend per recipient in this window. */
const RESEND_INTERVAL_MINUTES = 10;

const SIGNER_LIMIT_MESSAGE = `An agreement can have at most ${String(LIMITS.requiredSigners)} required signers.`;

export async function addRecipient(
  ctx: CommandContext,
  command: CommandOf<"add_recipient">,
): Promise<void> {
  const { db, agreement, state } = ctx;
  if (command.isSigner && state.round !== null) {
    throw conflict("Signers are fixed while signatures are requested.");
  }
  if (command.isSigner && state.signers.length >= LIMITS.requiredSigners) {
    throw new DomainError("invalid", SIGNER_LIMIT_MESSAGE);
  }
  const live = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM dripsign.recipient
     WHERE tenant_id = $1 AND agreement_id = $2 AND revoked_at IS NULL`,
    [agreement.tenantId, agreement.id],
  );
  if ((live.rows[0]?.count ?? 0) >= LIMITS.recipients) {
    throw new DomainError(
      "invalid",
      `An agreement can have at most ${String(LIMITS.recipients)} recipients.`,
    );
  }
  const recipient = { id: randomUUID(), name: command.name, email: command.email };
  await uniqueOrConflict("recipient_live_email", "This person is already a recipient.", () =>
    db.query(
      `INSERT INTO dripsign.recipient (tenant_id, agreement_id, id, email, name, is_signer)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        agreement.tenantId,
        agreement.id,
        recipient.id,
        recipient.email,
        recipient.name,
        command.isSigner,
      ],
    ),
  );
  // Before the first revision there is nothing to read yet; publishing invites everyone.
  if (agreement.currentRevisionId !== null) {
    await notify(db, { agreement, template: "invite", to: [recipient], resourceId: recipient.id });
    await markInvited(db, agreement.tenantId, [recipient.id]);
  }
  if (command.isSigner) await restageForSigners(db, agreement, [...state.signers, recipient]);
}

/** Removing a frozen signer of the active round voids it; their signature, if any, stays. */
export async function removeRecipient(
  ctx: CommandContext,
  command: CommandOf<"remove_recipient">,
): Promise<void> {
  const { db, agreement, state } = ctx;
  const removed = await db.query<{ isSigner: boolean; inRound: boolean }>(
    `UPDATE dripsign.recipient r SET revoked_at = now()
     WHERE r.tenant_id = $1 AND r.agreement_id = $2 AND r.id = $3 AND r.revoked_at IS NULL
     RETURNING r.is_signer AS "isSigner",
       EXISTS (SELECT 1 FROM dripsign.round_signer rs
               WHERE rs.tenant_id = r.tenant_id AND rs.round_id = $4
                 AND rs.recipient_id = r.id) AS "inRound"`,
    [agreement.tenantId, agreement.id, command.recipientId, state.round?.id ?? null],
  );
  const row = removed.rows[0];
  if (row === undefined) throw notFound();
  if (row.inRound && state.round !== null) {
    await endRound(ctx, {
      round: state.round,
      reason: "signer_removed",
      causedBy: command.recipientId,
    });
  }
  if (row.isSigner) {
    const signers = state.signers.filter((signer) => signer.id !== command.recipientId);
    await restageForSigners(db, agreement, signers);
  }
}

export async function setSigner(
  ctx: CommandContext,
  command: CommandOf<"set_signer">,
): Promise<void> {
  const { db, agreement, state } = ctx;
  const found = await db.query<LiveSigner & { isSigner: boolean }>(
    `SELECT id, name, email, is_signer AS "isSigner" FROM dripsign.recipient
     WHERE tenant_id = $1 AND agreement_id = $2 AND id = $3 AND revoked_at IS NULL`,
    [agreement.tenantId, agreement.id, command.recipientId],
  );
  const recipient = found.rows[0];
  if (recipient === undefined) throw notFound();
  if (recipient.isSigner === command.isSigner) return;
  if (command.isSigner && state.signers.length >= LIMITS.requiredSigners) {
    throw new DomainError("invalid", SIGNER_LIMIT_MESSAGE);
  }
  await db.query("UPDATE dripsign.recipient SET is_signer = $3 WHERE tenant_id = $1 AND id = $2", [
    agreement.tenantId,
    recipient.id,
    command.isSigner,
  ]);
  const { id, name, email } = recipient;
  const signers = command.isSigner
    ? [...state.signers, { id, name, email }]
    : state.signers.filter((signer) => signer.id !== id);
  await restageForSigners(db, agreement, signers);
}

/** An unsigned signer of the active round gets the signing request again, others the invite. */
export async function resendInvite(
  ctx: CommandContext,
  command: CommandOf<"resend_invite">,
): Promise<void> {
  const { db, agreement, state } = ctx;
  const found = await db.query<{ email: string; recent: boolean; awaitingSignature: boolean }>(
    `SELECT r.email,
       coalesce(r.last_invited_at > now() - make_interval(mins => $5), false) AS recent,
       EXISTS (SELECT 1 FROM dripsign.round_signer rs
               WHERE rs.tenant_id = r.tenant_id AND rs.round_id = $4 AND rs.recipient_id = r.id
                 AND NOT EXISTS (SELECT 1 FROM dripsign.signature s
                                 WHERE s.tenant_id = rs.tenant_id AND s.round_id = rs.round_id
                                   AND s.recipient_id = rs.recipient_id)) AS "awaitingSignature"
     FROM dripsign.recipient r
     WHERE r.tenant_id = $1 AND r.agreement_id = $2 AND r.id = $3 AND r.revoked_at IS NULL`,
    [
      agreement.tenantId,
      agreement.id,
      command.recipientId,
      state.round?.status === "active" ? state.round.id : null,
      RESEND_INTERVAL_MINUTES,
    ],
  );
  const recipient = found.rows[0];
  if (recipient === undefined) throw notFound();
  if (recipient.recent) {
    throw new DomainError(
      "rate_limited",
      `You can resend an invitation once every ${String(RESEND_INTERVAL_MINUTES)} minutes.`,
    );
  }
  await notify(db, {
    agreement,
    template: recipient.awaitingSignature ? "sign_request" : "invite",
    to: [{ id: command.recipientId, email: recipient.email }],
    resourceId: null,
  });
  await markInvited(db, agreement.tenantId, [command.recipientId]);
}
