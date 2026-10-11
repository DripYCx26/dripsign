import type { TimelineItem, TimelineKind, ViewerView } from "@dripsign/core/types";

type Describe = (item: TimelineItem, viewer: ViewerView) => string;

const text = (item: TimelineItem, key: string): string | null => {
  const value = item.detail[key];
  return typeof value === "string" ? value : null;
};

function signed(item: TimelineItem, viewer: ViewerView): string {
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
  agreement_voided: () => "Agreement voided",
};

/** One short line for a milestone, or null when the timeline row is not one. */
export function describeMilestone(item: TimelineItem, viewer: ViewerView): string | null {
  return MILESTONES[item.kind]?.(item, viewer) ?? null;
}
