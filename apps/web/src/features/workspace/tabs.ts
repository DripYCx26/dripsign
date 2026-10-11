import type { AgreementView } from "@dripsign/core/types";
import { threadItems } from "../thread/model.ts";

/** `chat` is the thread rail and `document` the pane beside it; on a phone it is the one shown. */
export type WorkspaceTab = "chat" | "document";

/**
 * The tab a phone opens on when the address names none: the document when the chat has nothing to
 * offer (no composer in a draft, a signed or a voided agreement, or nothing said yet), else chat.
 */
export function defaultTab(view: AgreementView): WorkspaceTab {
  const composer =
    view.allowedActions.includes("message") || view.allowedActions.includes("propose");
  return composer && threadItems(view).length > 0 ? "chat" : "document";
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
