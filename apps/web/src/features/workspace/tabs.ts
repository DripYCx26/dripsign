import type { AgreementView } from "@dripsign/core/types";
import { STARTER_SECTION } from "../draft/templates.ts";

type TabSource = Pick<
  AgreementView,
  "allowedActions" | "messages" | "proposals" | "aiSuggestions" | "draft"
>;

/** `chat` is the rail and `document` the pane beside it; on a phone it is the one shown. */
export type WorkspaceTab = "chat" | "document";

/**
 * What the rail is: `none` when there is nothing to say and no way to say it, `narrow` when it is
 * history only (signed, voided), `full` for the thread, and `draft` for staff's assistant while
 * the agreement is a draft that no revision has been published from. A draft with the assistant
 * off has a rail only for the starters of a blank draft, or for turns it already holds.
 */
export type RailMode = "none" | "narrow" | "full" | "draft";

/** Milestones alone are not a conversation: only what people wrote or proposed counts. */
function hasConversation(view: TabSource): boolean {
  return view.messages.length > 0 || view.proposals.length > 0;
}

/** The draft still holds only the untouched section a new agreement starts with. */
export function isBlankDraft(view: Pick<AgreementView, "draft">): boolean {
  const sections = view.draft?.source.sections ?? [];
  const [only] = sections;
  return (
    sections.length === 1 &&
    only?.heading === STARTER_SECTION.heading &&
    only.paragraphs.join("\n") === STARTER_SECTION.paragraphs.join("\n")
  );
}

export function railMode(view: TabSource): RailMode {
  const can = (action: AgreementView["allowedActions"][number]) =>
    view.allowedActions.includes(action);
  if (can("message") || can("propose")) return "full";
  if (can("save_draft") && (can("ask_ai") || view.aiSuggestions.length > 0 || isBlankDraft(view))) {
    return "draft";
  }
  return hasConversation(view) ? "narrow" : "none";
}

/**
 * The tab a phone opens on when the address names none: the document unless people have already
 * written or proposed something and the viewer can answer (milestones alone do not count).
 */
export function defaultTab(view: TabSource): WorkspaceTab {
  return railMode(view) === "full" && hasConversation(view) ? "chat" : "document";
}

/** A `?tab=` value from the URL; nothing when it is missing or unknown, so `defaultTab` decides. */
export function parseTab(value: string | string[] | undefined): WorkspaceTab | undefined {
  return value === "chat" || value === "document" ? value : undefined;
}

/** A `?rev=` value: a positive whole number, else nothing. */
export function parseRevision(value: string | string[] | undefined): number | undefined {
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/u.test(value)) return undefined;
  return Number(value);
}
