import type { AgreementStatus, InboxItem, StaffListItem } from "@dripsign/core/types";
import type { SignerProgressModel } from "./SignerProgress.tsx";

/** One line of a list, whoever it is for: everything the row draws, already worded. */
export interface RowModel {
  readonly id: string;
  readonly href: string;
  readonly title: string;
  readonly subline: string;
  readonly status: AgreementStatus;
  /** What happens next, in the words of the workspace's primary action. */
  readonly phrase: string;
  readonly progress: SignerProgressModel | null;
  readonly updatedAt: string;
}

export interface RowGroup {
  readonly id: string;
  /** Null for a single flat list, which needs no heading. */
  readonly heading: string | null;
  readonly rows: readonly RowModel[];
}

type Standing<G extends string> = Readonly<{ group: G; phrase: string }>;

type StaffGroup = "needs" | "waiting" | "drafts" | "done";
type InboxGroup = "sign" | "respond" | "waiting" | "done";

const STAFF_HEADINGS: Readonly<Record<StaffGroup, string>> = {
  needs: "Needs you",
  waiting: "Waiting on others",
  drafts: "Drafts",
  done: "Done",
};

const INBOX_HEADINGS: Readonly<Record<InboxGroup, string>> = {
  sign: "Needs your signature",
  respond: "Your turn to respond",
  waiting: "Waiting on others",
  done: "Completed",
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function progressOf(item: {
  status: AgreementStatus;
  signedCount: number;
  requiredCount: number;
  finalizing: boolean;
  finalizingDelayed: boolean;
}): SignerProgressModel | null {
  const live = item.status === "signing" || item.status === "signed";
  if (!live || item.requiredCount === 0) return null;
  return {
    signed: item.signedCount,
    required: item.requiredCount,
    finalizing: item.finalizing,
    delayed: item.finalizingDelayed,
  };
}

// Mirrors the staff side of the core's `allowedActions`, so a row's phrase names the action the
// workspace will offer first. The list read does not carry the allowed actions themselves.
function draftStanding(item: StaffListItem): Standing<StaffGroup> {
  if (item.preparation === "failed") return { group: "needs", phrase: "Retry preparation" };
  if (item.preparation === "preparing") return { group: "drafts", phrase: "Preparing PDF…" };
  if (item.publicationNeeded && item.preparation === "ready") {
    const phrase = item.hasRevision ? "Review and publish changes" : "Review and publish";
    return { group: "needs", phrase };
  }
  return { group: "drafts", phrase: "Add terms" };
}

function negotiatingStanding(item: StaffListItem): Standing<StaffGroup> {
  if (item.pendingProposalBy === "recipient") {
    const who = item.pendingProposalAuthor;
    return {
      group: "needs",
      phrase: who === null ? "Review the proposal" : `Review ${who}’s proposal`,
    };
  }
  if (item.preparation === "failed" || item.preparation === "preparing" || item.publicationNeeded) {
    return draftStanding(item);
  }
  if (item.pendingProposalBy === "staff") {
    return { group: "waiting", phrase: "Waiting for recipients to respond" };
  }
  return { group: "needs", phrase: "Request signatures" };
}

/** The group and next-step phrase of one staff list item. */
export function staffStanding(item: StaffListItem): Standing<StaffGroup> {
  switch (item.status) {
    case "void":
      return { group: "done", phrase: "Voided" };
    case "signed":
      return { group: "done", phrase: "Signed by everyone" };
    case "signing":
      return item.finalizing
        ? { group: "waiting", phrase: "All signatures are in" }
        : { group: "waiting", phrase: "Waiting for signatures" };
    case "negotiating":
      return negotiatingStanding(item);
    case "draft":
      return draftStanding(item);
  }
}

function recipientNames(item: StaffListItem): string {
  if (item.recipients.length === 0) return "No recipients yet";
  const shown = item.recipients.slice(0, 3).map((recipient) => recipient.name);
  const rest = item.recipients.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${String(rest)}` : shown.join(", ");
}

function staffRow(item: StaffListItem): RowModel {
  return {
    id: item.id,
    href: `/staff/agreements/${item.id}`,
    title: item.title,
    subline: recipientNames(item),
    status: item.status,
    phrase: staffStanding(item).phrase,
    progress: progressOf(item),
    updatedAt: item.updatedAt,
  };
}

function signingStanding(item: InboxItem): Standing<InboxGroup> {
  if (item.finalizing) return { group: "waiting", phrase: "All signatures are in" };
  if (item.viewerIsRequiredSigner && !item.viewerHasSigned) {
    return { group: "sign", phrase: "Review and sign" };
  }
  if (item.viewerHasSigned) {
    const others = item.requiredCount - item.signedCount;
    return {
      group: "waiting",
      phrase: `You signed · waiting on ${String(others)} ${plural(others, "other", "others")}`,
    };
  }
  return { group: "waiting", phrase: "Waiting for signatures" };
}

/** The group and next-step phrase of one inbox item, from the recipient's side. */
export function inboxStanding(item: InboxItem): Standing<InboxGroup> {
  switch (item.status) {
    case "void":
      return { group: "done", phrase: "Voided" };
    case "signed":
      return { group: "done", phrase: "Signed" };
    case "signing":
      return signingStanding(item);
    case "negotiating":
    case "draft":
      if (item.pendingProposalBy === "staff") {
        return { group: "respond", phrase: "Respond to proposal" };
      }
      return item.pendingProposalBy === "recipient"
        ? { group: "waiting", phrase: `Waiting for ${item.orgName} to respond` }
        : { group: "waiting", phrase: `Waiting on ${item.orgName}` };
  }
}

function inboxRow(item: InboxItem): RowModel {
  return {
    id: item.id,
    href: `/agreements/${item.id}`,
    title: item.title,
    subline: item.orgName,
    status: item.status,
    phrase: inboxStanding(item).phrase,
    progress: progressOf(item),
    updatedAt: item.updatedAt,
  };
}

function group<G extends string>(
  order: readonly G[],
  headings: Readonly<Record<G, string>>,
  entries: readonly (readonly [G, RowModel])[],
): RowGroup[] {
  return order
    .map((key) => ({
      id: key,
      heading: headings[key],
      rows: entries.filter(([at]) => at === key).map(([, row]) => row),
    }))
    .filter((section) => section.rows.length > 0);
}

/** Staff items as groups (Needs you, Waiting on others, Drafts, Done), empty groups dropped. */
export function groupStaffRows(items: readonly StaffListItem[]): RowGroup[] {
  return group(
    ["needs", "waiting", "drafts", "done"],
    STAFF_HEADINGS,
    items.map((item) => [staffStanding(item).group, staffRow(item)] as const),
  );
}

/** Staff items as one flat, headingless list, for a filtered or searched view. */
export function flatStaffRows(items: readonly StaffListItem[]): RowGroup[] {
  return items.length === 0 ? [] : [{ id: "all", heading: null, rows: items.map(staffRow) }];
}

/** Inbox items as groups, empty groups dropped. */
export function groupInboxRows(items: readonly InboxItem[]): RowGroup[] {
  return group(
    ["sign", "respond", "waiting", "done"],
    INBOX_HEADINGS,
    items.map((item) => [inboxStanding(item).group, inboxRow(item)] as const),
  );
}
