// The shared thread: messages and turn-based proposals. Accepting wording stages it into the
// private draft; only a reviewed publish turns it into a revision.
import { randomUUID } from "node:crypto";
import { canonicalJson, documentSourceSchema } from "../schema.ts";
import type { CommandOf, DocumentSource } from "../schema.ts";
import { stageDraft } from "./revisions.ts";
import { endRound } from "./signing.ts";
import { conflict, parseOrInvalid, touchAgreement, uniqueOrConflict } from "./state.ts";
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
  await supersede(ctx, command.proposalId);
  await insertProposal(ctx, {
    text: command.text,
    replacementSource: command.replacementSource ?? null,
    supersedesId: command.proposalId,
  });
}

/** The author takes the pending proposal back; the policy already limited this to its author. */
export async function withdraw(ctx: CommandContext, command: CommandOf<"withdraw">): Promise<void> {
  await supersede(ctx, command.proposalId);
}

async function supersede(ctx: CommandContext, proposalId: string): Promise<void> {
  const { db, agreement, actor } = ctx;
  if (ctx.state.pending?.id !== proposalId) throw conflict();
  await db.query(
    `UPDATE dripsign.proposal SET status = 'superseded', decided_by = $3, decided_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`,
    [agreement.tenantId, proposalId, actor.email],
  );
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

export async function accept(ctx: CommandContext, command: CommandOf<"accept">): Promise<void> {
  const { db, agreement, state } = ctx;
  const { replacement, base } = await decide(ctx, command.proposalId, "accepted");
  if (replacement === null) {
    // Wording without replacement terms still needs a staff edit and a new revision.
    await db.query(
      "UPDATE dripsign.agreement SET draft_dirty = true WHERE tenant_id = $1 AND id = $2",
      [agreement.tenantId, agreement.id],
    );
    return;
  }
  const merged = mergeProposal(agreement.draft.source, base, replacement);
  await stageDraft(db, agreement, {
    source: parseOrInvalid(documentSourceSchema, merged),
    signers: state.signers,
    dirty: true,
  });
}

/**
 * Applies only what the proposal changed against its base revision, by section id, so staff edits
 * made to other sections (and the draft title) while it waited survive.
 */
function mergeProposal(
  draft: DocumentSource,
  base: DocumentSource,
  proposed: DocumentSource,
): DocumentSource {
  const kept = new Set(proposed.sections.map((section) => section.id));
  const removed = new Set(base.sections.filter((s) => !kept.has(s.id)).map((s) => s.id));
  const baseById = new Map(base.sections.map((section) => [section.id, canonicalJson(section)]));
  const changed = proposed.sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => baseById.get(section.id) !== canonicalJson(section));
  const changedById = new Map(changed.map(({ section }) => [section.id, section]));
  const sections = draft.sections
    .filter((section) => !removed.has(section.id))
    .map((section) => changedById.get(section.id) ?? section);
  for (const { section, index } of changed) {
    if (!sections.some((s) => s.id === section.id)) sections.splice(index, 0, section);
  }
  return { ...draft, sections };
}

export async function reject(ctx: CommandContext, command: CommandOf<"reject">): Promise<void> {
  await decide(ctx, command.proposalId, "rejected");
}

/** Decides the pending proposal; the policy already limited this to the side that did not write it. */
async function decide(
  ctx: CommandContext,
  proposalId: string,
  status: "accepted" | "rejected",
): Promise<{ readonly replacement: DocumentSource | null; readonly base: DocumentSource }> {
  const { db, agreement, actor } = ctx;
  if (ctx.state.pending?.id !== proposalId) throw conflict();
  const decided = await db.query<{ replacement: DocumentSource | null; base: DocumentSource }>(
    `UPDATE dripsign.proposal p SET status = $3, decided_by = $4, decided_at = now()
     FROM dripsign.revision v
     WHERE p.tenant_id = $1 AND p.id = $2 AND p.status = 'pending'
       AND v.tenant_id = p.tenant_id AND v.id = p.base_revision_id
     RETURNING p.replacement_source AS replacement, v.source AS base`,
    [agreement.tenantId, proposalId, status, actor.email],
  );
  const row = decided.rows[0];
  if (row === undefined) throw conflict();
  return row;
}
