import { documentSourceSchema, type DocumentSource } from "@dripsign/core/schema";
import type {
  AgreementView,
  Capacity,
  MessageView,
  ParticipantRef,
  ProposalView,
  RevisionView,
} from "@dripsign/core/types";
import { describeMilestone } from "../manage/activity.ts";
import type { TextScope } from "./useStoredText.ts";

/** Where focus returns when proposing ends, so typing can go on. */
export const MESSAGE_FIELD_ID = "message-field";

/** The revision the agreement stands on; null before the first publish. */
export function currentRevision(view: AgreementView): RevisionView | null {
  const number = view.agreement.currentRevisionNumber;
  if (number === null) return null;
  return view.revisions.find((revision) => revision.number === number) ?? null;
}

/** The one open proposal, if any (the database allows at most one). */
function pendingProposal(view: AgreementView): ProposalView | null {
  return view.proposals.find((proposal) => proposal.status === "pending") ?? null;
}

type ThreadEntry =
  | Readonly<{ kind: "message"; key: string; at: string; message: MessageView }>
  | Readonly<{ kind: "proposal"; key: string; at: string; proposal: ProposalView }>
  /** Milestones that happened in the same minute, one line each. */
  | Readonly<{ kind: "activity"; key: string; at: string; lines: readonly string[] }>;

/** `timed`: a message or card shows its time (see `TIME_GAP_MS`); milestones always do. */
export type ThreadItem = ThreadEntry & Readonly<{ timed: boolean }>;

type ThreadSource = Pick<AgreementView, "messages" | "proposals" | "timeline" | "viewer">;

const MINUTE_MS = 60_000;
/** A time is shown on the first item, the last, and after a pause longer than this. */
const TIME_GAP_MS = 5 * MINUTE_MS;

/** Folds neighbouring milestones of the same minute into one row; order is never changed. */
function groupMilestones(items: readonly ThreadEntry[]): ThreadEntry[] {
  const grouped: ThreadEntry[] = [];
  for (const item of items) {
    const last = grouped.at(-1);
    if (
      last?.kind === "activity" &&
      item.kind === "activity" &&
      Math.floor(Date.parse(last.at) / MINUTE_MS) === Math.floor(Date.parse(item.at) / MINUTE_MS)
    ) {
      grouped[grouped.length - 1] = { ...last, lines: [...last.lines, ...item.lines] };
    } else {
      grouped.push(item);
    }
  }
  return grouped;
}

function markTimes(items: readonly ThreadEntry[]): ThreadItem[] {
  return items.map((item, index) => {
    const previous = items[index - 1];
    const timed =
      previous === undefined ||
      index === items.length - 1 ||
      Date.parse(item.at) - Date.parse(previous.at) > TIME_GAP_MS;
    return { ...item, timed };
  });
}

/**
 * Messages, proposals and the agreement's milestones as one conversation, oldest first. A
 * countered proposal is not an item: it folds into the card that replaced it (`earlierVersions`).
 * A withdrawn one (superseded with nothing replacing it) keeps its card.
 */
export function threadItems(view: ThreadSource): readonly ThreadItem[] {
  const countered = new Set(view.proposals.map((proposal) => proposal.supersedesId));
  const items: ThreadEntry[] = [
    ...view.messages.map((message): ThreadEntry => ({
      kind: "message",
      key: `message-${message.id}`,
      at: message.createdAt,
      message,
    })),
    ...view.proposals
      .filter((proposal) => !countered.has(proposal.id))
      .map((proposal): ThreadEntry => ({
        kind: "proposal",
        key: `proposal-${proposal.id}`,
        at: proposal.createdAt,
        proposal,
      })),
    ...view.timeline.flatMap((item, index): ThreadEntry[] => {
      const line = describeMilestone(item, { viewer: view.viewer });
      // The view has no row id; time, kind and position are stable for one snapshot.
      return line === null
        ? []
        : [
            {
              kind: "activity",
              key: `activity-${item.at}-${item.kind}-${String(index)}`,
              at: item.at,
              lines: [line],
            },
          ];
    }),
  ];
  return markTimes(
    groupMilestones(
      items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key)),
    ),
  );
}

/** The scope a viewer's stored composer text lives under. */
export function textScope(view: AgreementView, capacity: Capacity): TextScope {
  return { email: view.viewer.email, capacity, agreementId: view.agreement.id };
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

type Section = DocumentSource["sections"][number];

/** The first section a proposal adds, removes or rewrites, with its position in the source it is in. */
export function changedSection(
  before: DocumentSource | null,
  after: DocumentSource | null,
): Readonly<{ section: Section; index: number }> | null {
  if (before === null || after === null) return null;
  const sameWords = (a: Section, b: Section) =>
    a.heading === b.heading && a.paragraphs.join("\n") === b.paragraphs.join("\n");
  const rewritten = after.sections.findIndex((section) => {
    const old = before.sections.find((candidate) => candidate.id === section.id);
    return old === undefined || !sameWords(old, section);
  });
  const rewrittenSection = after.sections[rewritten];
  if (rewrittenSection !== undefined) return { section: rewrittenSection, index: rewritten };
  const removed = before.sections.findIndex(
    (section) => !after.sections.some((candidate) => candidate.id === section.id),
  );
  const removedSection = before.sections[removed];
  return removedSection === undefined ? null : { section: removedSection, index: removed };
}

/** The source the proposal was written against. */
export function baseSourceOf(view: AgreementView, proposal: ProposalView): DocumentSource | null {
  return view.revisions.find((revision) => revision.id === proposal.baseRevisionId)?.source ?? null;
}

/** "a change to Term" or, for a proposal without changed terms, "a change". */
export function describeChange(view: AgreementView, proposal: ProposalView): string {
  const changed = changedSection(baseSourceOf(view, proposal), proposal.replacementSource);
  if (changed === null) return "a change";
  return `a change to ${sectionLabel(changed.section.heading, changed.index)}`;
}

/** Whose move it is, as one sentence for the status announcer; null when nobody is waiting. */
export function turnSentence(view: AgreementView, capacity: Capacity): string | null {
  const pending = pendingProposal(view);
  if (pending === null) return null;
  if (pending.author.capacity !== capacity) {
    return `Your turn: ${pending.author.label} proposed ${describeChange(view, pending)}.`;
  }
  return `Waiting for ${otherSideLabel(view, capacity)} to respond.`;
}

/** The proposal that replaced this one, when a counterproposal superseded it. */
export function counteredBy(view: AgreementView, proposal: ProposalView): ParticipantRef | null {
  return view.proposals.find((other) => other.supersedesId === proposal.id)?.author ?? null;
}

/** The proposals a live one superseded, oldest first. */
export function earlierVersions(view: AgreementView, proposal: ProposalView): ProposalView[] {
  const earlier: ProposalView[] = [];
  let id = proposal.supersedesId;
  while (id !== null) {
    const found = view.proposals.find((other) => other.id === id);
    if (found === undefined) break;
    earlier.unshift(found);
    id = found.supersedesId;
  }
  return earlier;
}

/** The proposal a new proposal would counter: the other side's open one, when countering is allowed. */
export function counterTarget(view: AgreementView, capacity: Capacity): ProposalView | null {
  const pending = pendingProposal(view);
  if (pending === null || pending.author.capacity === capacity) return null;
  return view.allowedActions.includes("counter") ? pending : null;
}

/** A section's wording as one editable string, paragraphs separated by a blank line. */
export function wordingOf(section: Section): string {
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
