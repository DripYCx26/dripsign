import type { AgreementStatus, InboxItem, StaffListItem } from "@dripsign/core/types";
import { staffMove, staffMoveLabel, type StaffMove } from "@/features/workspace/nextStep.ts";
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

/** An empty phrase says nothing the row's status pill (or its signature progress) does not. */
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
  done: "Done",
};

function progressOf(item: {
  status: AgreementStatus;
  signedCount: number;
  requiredCount: number;
  finalizing: boolean;
  finalizingDelayed: boolean;
}): SignerProgressModel | null {
  if (item.status !== "signing" || item.requiredCount === 0) return null;
  return {
    signed: item.signedCount,
    required: item.requiredCount,
    finalizing: item.finalizing,
    delayed: item.finalizingDelayed,
  };
}

const STAFF_MOVE_GROUP: Readonly<Record<StaffMove, StaffGroup>> = {
  answer: "needs",
  retry: "needs",
  publish: "needs",
  request_signatures: "needs",
  needs_signer: "needs",
  preparing: "drafts",
  add_terms: "drafts",
  awaiting_answer: "waiting",
  none: "waiting",
};

/** The group and next-step phrase of one staff list item: the workspace's own staff move. */
function staffStanding(item: StaffListItem): Standing<StaffGroup> {
  if (item.status === "void" || item.status === "signed") return { group: "done", phrase: "" };
  const move = staffMove({
    ...item,
    requiredSigners: item.recipients.filter((recipient) => recipient.isSigner).length,
  });
  const group = move === "none" && item.status === "draft" ? "drafts" : STAFF_MOVE_GROUP[move];
  const who = item.pendingProposalAuthor;
  const phrase =
    move === "answer" && who !== null
      ? `Review ${who}’s proposal`
      : staffMoveLabel(move, item.status);
  return { group, phrase };
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

/** The group and next-step phrase of one inbox item, from the policy's answer for the recipient. */
function inboxStanding(item: InboxItem): Standing<InboxGroup> {
  if (item.status === "void" || item.status === "signed") return { group: "done", phrase: "" };
  if (item.allowedActions.includes("sign")) return { group: "sign", phrase: "Review and sign" };
  if (item.allowedActions.includes("accept")) {
    return { group: "respond", phrase: "Respond to proposal" };
  }
  if (item.status === "signing") {
    return {
      group: "waiting",
      phrase: item.viewerHasSigned && !item.finalizing ? "You signed" : "",
    };
  }
  return { group: "waiting", phrase: `Waiting on ${item.orgName}` };
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
