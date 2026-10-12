// The shared thread: messages and turn-based proposals. Accepting wording stages it into the
// private draft; only a reviewed publish turns it into a revision.
import { randomUUID } from "node:crypto";
import { DomainError } from "../errors.ts";
import { canonicalJson, documentSourceSchema } from "../schema.ts";
import type { CommandOf, DocumentSection, DocumentSource } from "../schema.ts";
import { stageDraft } from "./revisions.ts";
import { endRound } from "./signing.ts";
import { conflict, parseOrInvalid, touchAgreement, uniqueOrConflict } from "./state.ts";
import type { CommandContext } from "./state.ts";

const PENDING_EXISTS = "Another proposal is waiting for an answer. Reload to see it.";
const ONE_SECTION = "A proposal changes one section.";
const SECTION_REMOVED =
  "The draft no longer has this section. Staff can restore it, or the proposal can be declined.";

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
    replacementSource: command.replacementSource,
    supersedesId: null,
  });
}

export async function counter(ctx: CommandContext, command: CommandOf<"counter">): Promise<void> {
  await supersede(ctx, command.proposalId);
  await insertProposal(ctx, {
    text: command.text,
    replacementSource: command.replacementSource,
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
    readonly replacementSource: DocumentSource;
    readonly supersedesId: string | null;
  },
): Promise<void> {
  const { db, agreement, actor } = ctx;
  changedSection(await currentSource(ctx), proposal.replacementSource);
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
        JSON.stringify(proposal.replacementSource),
        proposal.supersedesId,
      ],
    ),
  );
}

export async function accept(ctx: CommandContext, command: CommandOf<"accept">): Promise<void> {
  const { db, agreement, state } = ctx;
  const { replacement, base } = await decide(ctx, command.proposalId, "accepted");
  const changed = changedSection(base, replacement);
  const draft = agreement.draft.source;
  if (!draft.sections.some((section) => section.id === changed.id)) {
    throw conflict(SECTION_REMOVED);
  }
  // Only the one section moves, so staff edits elsewhere (and the draft title) survive.
  const sections = draft.sections.map((section) => (section.id === changed.id ? changed : section));
  await stageDraft(db, agreement, {
    source: parseOrInvalid(documentSourceSchema, { ...draft, sections }),
    signers: state.signers,
    dirty: true,
  });
}

/**
 * The one section a replacement rewrites: same title, same section ids in the same order, and
 * exactly one section's heading or paragraphs different from the base revision.
 */
function changedSection(base: DocumentSource, proposed: DocumentSource): DocumentSection {
  const sameShape =
    proposed.title === base.title &&
    proposed.sections.length === base.sections.length &&
    proposed.sections.every((section, index) => section.id === base.sections[index]?.id);
  const changed = sameShape
    ? proposed.sections.filter(
        (section, index) => canonicalJson(section) !== canonicalJson(base.sections[index]),
      )
    : [];
  const [section] = changed;
  if (changed.length !== 1 || section === undefined) {
    throw new DomainError("invalid", ONE_SECTION);
  }
  return section;
}

/** The published revision a new proposal is written against. */
async function currentSource(ctx: CommandContext): Promise<DocumentSource> {
  const { db, agreement } = ctx;
  const found = await db.query<{ source: DocumentSource }>(
    "SELECT source FROM dripsign.revision WHERE tenant_id = $1 AND id = $2",
    [agreement.tenantId, agreement.currentRevisionId],
  );
  const row = found.rows[0];
  if (row === undefined) throw conflict();
  return row.source;
}

export async function reject(ctx: CommandContext, command: CommandOf<"reject">): Promise<void> {
  await decide(ctx, command.proposalId, "rejected");
}

/** Decides the pending proposal; the policy already limited this to the side that did not write it. */
async function decide(
  ctx: CommandContext,
  proposalId: string,
  status: "accepted" | "rejected",
): Promise<{ readonly replacement: DocumentSource; readonly base: DocumentSource }> {
  const { db, agreement, actor } = ctx;
  if (ctx.state.pending?.id !== proposalId) throw conflict();
  const decided = await db.query<{ replacement: DocumentSource; base: DocumentSource }>(
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
