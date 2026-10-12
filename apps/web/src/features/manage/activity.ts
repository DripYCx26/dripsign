import type { TimelineItem, TimelineKind, ViewerView } from "@dripsign/core/types";

/** What a milestone's wording depends on besides the timeline row itself. */
export type MilestoneContext = Readonly<{ viewer: ViewerView }>;

type Describe = (item: TimelineItem, context: MilestoneContext) => string;

const text = (item: TimelineItem, key: string): string | null => {
  const value = item.detail[key];
  return typeof value === "string" ? value : null;
};

function signed(item: TimelineItem, { viewer }: MilestoneContext): string {
  const recipientId = text(item, "recipientId");
  const mine = recipientId !== null && recipientId === viewer.recipientId;
  return mine ? "You signed" : `${text(item, "name") ?? "A signer"} signed`;
}

/**
 * The milestones the conversation shows. Everything else on the timeline (proposals, recipients,
 * hashes, typed names) is either a card already or evidence that lives in the audit record.
 */
const MILESTONES: Readonly<Partial<Record<TimelineKind, Describe>>> = {
  revision_published: (item) => `Revision ${String(item.detail.number)} published`,
  signing_requested: () => "Signatures requested",
  signature_recorded: signed,
  signing_completed: () => "Everyone signed",
  // The reason lives on the agreement and the workspace header shows it, once.
  agreement_voided: () => "Voided",
};

/** One short line for a milestone, or null when the timeline row is not one. */
export function describeMilestone(item: TimelineItem, context: MilestoneContext): string | null {
  return MILESTONES[item.kind]?.(item, context) ?? null;
}
