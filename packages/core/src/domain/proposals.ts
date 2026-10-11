// The shared thread: messages and turn-based proposals. Accepting wording stages it into the
// private draft; only a reviewed publish turns it into a revision.
import { randomUUID } from "node:crypto";
import { DomainError } from "../errors.ts";
import type { CommandOf, DocumentSource } from "../schema.ts";
import { stageDraft } from "./revisions.ts";
import { endRound } from "./signing.ts";
import { conflict, touchAgreement, uniqueOrConflict } from "./state.ts";
import type { CommandContext } from "./state.ts";

const PENDING_EXISTS = "Another proposal is waiting for an answer. Reload to see it.";

export async function addMessage(
  ctx: CommandContext,
  command: CommandOf<"message">,
): Promise<void> {
  const { db, agreement, actor } = ctx;
  await db.query(
    `INSERT INTO dripsign.message (tenant_id, agreement_id, id, author_capacity, author_email, body)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [agreement.tenantId, agreement.id, randomUUID(), actor.capacity, actor.email, command.body],
  );
  await touchAgreement(db, agreement, false);
}

/** A required signer proposing during an active round cancels it; earlier signatures stay. */
export async function propose(ctx: CommandContext, command: CommandOf<"propose">): Promise<void> {
  const { state } = ctx;
  if (state.round?.status === "active") {
    await endRound(ctx, {
      round: state.round,
      reason: "signer_proposal",
      causedBy: state.viewer.recipientId,
    });
  }
  await insertProposal(ctx, {
    text: command.text,
    replacementSource: command.replacementSource ?? null,
    supersedesId: null,
  });
}

export async function counter(ctx: CommandContext, command: CommandOf<"counter">): Promise<void> {
  const { db, agreement } = ctx;
  if (ctx.state.pending?.id !== command.proposalId) throw conflict();
  await db.query(
    `UPDATE dripsign.proposal SET status = 'superseded'
     WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`,
    [agreement.tenantId, command.proposalId],
  );
  await insertProposal(ctx, {
    text: command.text,
    replacementSource: command.replacementSource ?? null,
    supersedesId: command.proposalId,
  });
}

async function insertProposal(
  ctx: CommandContext,
  proposal: {
    readonly text: string;
    readonly replacementSource: DocumentSource | null;
    readonly supersedesId: string | null;
  },
): Promise<void> {
  const { db, agreement, actor } = ctx;
  if (proposal.replacementSource !== null) await requireWrittenRevision(ctx);
  const replacement =
    proposal.replacementSource === null ? null : JSON.stringify(proposal.replacementSource);
  await uniqueOrConflict("one_pending_proposal", PENDING_EXISTS, () =>
    db.query(
      `INSERT INTO dripsign.proposal (
         tenant_id, agreement_id, id, base_revision_id, author_capacity, author_email, text,
         replacement_source, supersedes_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        agreement.tenantId,
        agreement.id,
        randomUUID(),
        agreement.currentRevisionId,
        actor.capacity,
        actor.email,
        proposal.text,
        replacement,
        proposal.supersedesId,
      ],
    ),
  );
}

/** Replacement terms rewrite written terms; an uploaded PDF has none to replace. */
async function requireWrittenRevision(ctx: CommandContext): Promise<void> {
  const { db, agreement } = ctx;
  const found = await db.query(
    `SELECT 1 FROM dripsign.revision
     WHERE tenant_id = $1 AND id = $2 AND source IS NOT NULL`,
    [agreement.tenantId, agreement.currentRevisionId],
  );
  if (found.rowCount !== 1) {
    throw new DomainError("invalid", "Replacement wording applies only to written terms.");
  }
}

export async function accept(ctx: CommandContext, command: CommandOf<"accept">): Promise<void> {
  const { db, agreement, state } = ctx;
  const replacement = await decide(ctx, command.proposalId, "accepted");
  if (replacement === null) {
    // Wording without replacement terms still needs a staff edit and a new revision.
    await db.query(
      "UPDATE dripsign.agreement SET draft_dirty = true WHERE tenant_id = $1 AND id = $2",
      [agreement.tenantId, agreement.id],
    );
    return;
  }
  await stageDraft(db, agreement, {
    content: { source: replacement, upload: null },
    signers: state.signers,
    dirty: true,
  });
}

export async function reject(ctx: CommandContext, command: CommandOf<"reject">): Promise<void> {
  await decide(ctx, command.proposalId, "rejected");
}

/** Decides the pending proposal; the policy already limited this to the side that did not write it. */
async function decide(
  ctx: CommandContext,
  proposalId: string,
  status: "accepted" | "rejected",
): Promise<DocumentSource | null> {
  const { db, agreement, actor } = ctx;
  if (ctx.state.pending?.id !== proposalId) throw conflict();
  const decided = await db.query<{ replacementSource: DocumentSource | null }>(
    `UPDATE dripsign.proposal SET status = $3, decided_by = $4, decided_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status = 'pending'
     RETURNING replacement_source AS "replacementSource"`,
    [agreement.tenantId, proposalId, status, actor.email],
  );
  const row = decided.rows[0];
  if (row === undefined) throw conflict();
  return row.replacementSource;
}
