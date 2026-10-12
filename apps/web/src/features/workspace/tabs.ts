import type { AgreementView } from "@dripsign/core/types";

type TabSource = Pick<AgreementView, "allowedActions" | "messages" | "proposals">;

/** `chat` is the rail and `document` the pane beside it; on a phone it is the one shown. */
export type WorkspaceTab = "chat" | "document";

/**
 * What the rail is: `none` when there is nothing to say and no way to say it, `narrow` when it is
 * history only (signed, voided), `full` for the thread, and `draft` for staff's assistant while
 * the agreement is a draft that no revision has been published from.
 */
export type RailMode = "none" | "narrow" | "full" | "draft";

/** Milestones alone are not a conversation: only what people wrote or proposed counts. */
function hasConversation(view: TabSource): boolean {
  return view.messages.length > 0 || view.proposals.length > 0;
}

export function railMode(view: TabSource): RailMode {
  if (view.allowedActions.includes("message") || view.allowedActions.includes("propose")) {
    return "full";
  }
  if (view.allowedActions.includes("save_draft")) return "draft";
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
