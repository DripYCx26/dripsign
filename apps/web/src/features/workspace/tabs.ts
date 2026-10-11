/** `thread` and `activity` fill the left pane; `document` is the phone's way to the right pane. */
export type WorkspaceTab = "thread" | "activity" | "document";

const TABS: readonly WorkspaceTab[] = ["thread", "activity", "document"];

/** A `?tab=` value from the URL, or the thread when it is missing or unknown. */
export function parseTab(value: string | string[] | undefined): WorkspaceTab {
  return TABS.find((tab) => tab === value) ?? "thread";
}

/** A `?rev=` value: a positive whole number, else nothing. */
export function parseRevision(value: string | string[] | undefined): number | undefined {
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/u.test(value)) return undefined;
  return Number(value);
}
