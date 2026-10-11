/** `chat` is the thread rail and `document` the pane beside it; on a phone it is the one shown. */
export type WorkspaceTab = "chat" | "document";

/** A `?tab=` value from the URL, or the chat when it is missing or unknown. */
export function parseTab(value: string | string[] | undefined): WorkspaceTab {
  return value === "document" ? "document" : "chat";
}

/** A `?rev=` value: a positive whole number, else nothing. */
export function parseRevision(value: string | string[] | undefined): number | undefined {
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/u.test(value)) return undefined;
  return Number(value);
}
