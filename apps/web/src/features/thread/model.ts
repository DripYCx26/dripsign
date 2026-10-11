import { documentSourceSchema, type DocumentSource } from "@dripsign/core/schema";
import type {
  AgreementView,
  Capacity,
  MessageView,
  ParticipantRef,
  ProposalView,
  RevisionView,
} from "@dripsign/core/types";

/** The revision the agreement stands on; null before the first publish. */
export function currentRevision(view: AgreementView): RevisionView | null {
  const number = view.agreement.currentRevisionNumber;
  if (number === null) return null;
  return view.revisions.find((revision) => revision.number === number) ?? null;
}

/** The one open proposal, if any (the database allows at most one). */
export function pendingProposal(view: AgreementView): ProposalView | null {
  return view.proposals.find((proposal) => proposal.status === "pending") ?? null;
}

export type ThreadItem =
  | Readonly<{ kind: "message"; key: string; at: string; message: MessageView }>
  | Readonly<{ kind: "proposal"; key: string; at: string; proposal: ProposalView }>;

/** Messages and proposals as one conversation, oldest first. */
export function threadItems(view: AgreementView): readonly ThreadItem[] {
  const items: ThreadItem[] = [
    ...view.messages.map((message): ThreadItem => ({
      kind: "message",
      key: `message-${message.id}`,
      at: message.createdAt,
      message,
    })),
    ...view.proposals.map((proposal): ThreadItem => ({
      kind: "proposal",
      key: `proposal-${proposal.id}`,
      at: proposal.createdAt,
      proposal,
    })),
  ];
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key));
}

/** Staff are one side; each recipient is their own voice. */
export function isOwn(author: ParticipantRef, view: AgreementView): boolean {
  if (author.capacity !== view.viewer.capacity) return false;
  return author.capacity === "staff" || author.recipientId === view.viewer.recipientId;
}

/** Who the viewer is waiting on: the organisation for a recipient, the recipients for staff. */
export function otherSideLabel(view: AgreementView, capacity: Capacity): string {
  if (capacity === "recipient") return view.orgName;
  const live = view.recipients.filter((recipient) => recipient.removedAt === null);
  const only = live.length === 1 ? live[0] : undefined;
  return only === undefined ? "recipients" : only.name;
}

export function sectionLabel(heading: string, index: number): string {
  const trimmed = heading.trim();
  return trimmed === "" ? `Section ${String(index + 1)}` : trimmed;
}

/** The first section a proposal adds, removes or rewrites, named for the sentence about it. */
export function changedSectionLabel(
  before: DocumentSource | null,
  after: DocumentSource | null,
): string | null {
  if (before === null || after === null) return null;
  const sameWords = (
    a: DocumentSource["sections"][number],
    b: DocumentSource["sections"][number],
  ) => a.heading === b.heading && a.paragraphs.join("\n") === b.paragraphs.join("\n");
  const rewritten = after.sections.findIndex((section) => {
    const old = before.sections.find((candidate) => candidate.id === section.id);
    return old === undefined || !sameWords(old, section);
  });
  const rewrittenSection = after.sections[rewritten];
  if (rewrittenSection !== undefined) return sectionLabel(rewrittenSection.heading, rewritten);
  const removed = before.sections.findIndex(
    (section) => !after.sections.some((candidate) => candidate.id === section.id),
  );
  const removedSection = before.sections[removed];
  return removedSection === undefined ? null : sectionLabel(removedSection.heading, removed);
}

/** The source the proposal was written against. */
export function baseSourceOf(view: AgreementView, proposal: ProposalView): DocumentSource | null {
  return view.revisions.find((revision) => revision.id === proposal.baseRevisionId)?.source ?? null;
}

/** "a change to Term" or, for a PDF or an unchanged-terms proposal, "a change". */
export function describeChange(view: AgreementView, proposal: ProposalView): string {
  const section = changedSectionLabel(baseSourceOf(view, proposal), proposal.replacementSource);
  return section === null ? "a change" : `a change to ${section}`;
}

/** The proposal that replaced this one, when a counterproposal superseded it. */
export function counteredBy(view: AgreementView, proposal: ProposalView): ParticipantRef | null {
  return view.proposals.find((other) => other.supersedesId === proposal.id)?.author ?? null;
}

/** The proposal a new proposal would counter: the other side's open one, when countering is allowed. */
export function counterTarget(view: AgreementView, capacity: Capacity): ProposalView | null {
  const pending = pendingProposal(view);
  if (pending === null || pending.author.capacity === capacity) return null;
  return view.allowedActions.includes("counter") ? pending : null;
}

/** A section's wording as one editable string, paragraphs separated by a blank line. */
export function wordingOf(section: DocumentSource["sections"][number]): string {
  return section.paragraphs.join("\n\n");
}

/** The paragraphs a wording holds: blank-line separated, trimmed, none empty. */
export function paragraphsOf(wording: string): string[] {
  return wording
    .replace(/\r\n?/gu, "\n")
    .split(/\n[^\S\n]*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

export type SectionReplacement = Readonly<{
  /** The whole source with that one section's paragraphs swapped; null when it is not valid. */
  source: DocumentSource | null;
  error: string | undefined;
}>;

/** The source a section proposal would publish: the same terms, one section rewritten. */
export function replaceSection(
  source: DocumentSource,
  sectionId: string,
  paragraphs: readonly string[],
): SectionReplacement {
  if (paragraphs.length === 0) return { source: null, error: "Write the wording you propose." };
  const parsed = documentSourceSchema.safeParse({
    ...source,
    sections: source.sections.map((section) =>
      section.id === sectionId ? { ...section, paragraphs } : section,
    ),
  });
  if (parsed.success) return { source: parsed.data, error: undefined };
  return { source: null, error: parsed.error.issues[0]?.message ?? "Check the wording." };
}
