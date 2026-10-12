import { expect, it } from "vitest";
import type { AgreementAction, Capacity } from "../types.ts";
import { allowedActions, STAFF_ONLY_ACTIONS } from "./policy.ts";
import type { PolicySnapshot, PolicyViewer } from "./policy.ts";

const negotiating: PolicySnapshot = {
  status: "negotiating",
  hasRevision: true,
  publicationNeeded: false,
  preparation: "ready",
  draftSignerCount: 1,
  draftHasSource: true,
  pendingProposalBy: null,
  round: null,
  aiEnabled: true,
  readyAiSuggestions: 0,
};
const signing: PolicySnapshot = { ...negotiating, status: "signing", round: "active" };
const observer: PolicyViewer = {
  isRequiredSigner: false,
  hasSigned: false,
  ownsPendingProposal: false,
};
const signer: PolicyViewer = { ...observer, isRequiredSigner: true };

interface Row {
  readonly rule: string;
  readonly snapshot: PolicySnapshot;
  readonly capacity: Capacity;
  readonly viewer?: PolicyViewer;
  readonly includes?: readonly AgreementAction[];
  readonly excludes?: readonly AgreementAction[];
  readonly exactly?: readonly AgreementAction[];
}

const rows: readonly Row[] = [
  {
    rule: "staff publish needs unpublished draft changes",
    snapshot: { ...negotiating, publicationNeeded: true },
    capacity: "staff",
    includes: ["publish"],
    excludes: ["request_signatures"],
  },
  {
    rule: "a clean draft cannot be published but can go to signing",
    snapshot: negotiating,
    capacity: "staff",
    includes: ["request_signatures"],
    excludes: ["publish"],
  },
  {
    rule: "the author side cannot accept its own proposal, nor take back another's",
    snapshot: { ...negotiating, pendingProposalBy: "recipient" },
    capacity: "recipient",
    viewer: observer,
    excludes: ["accept", "counter", "reject", "propose", "withdraw"],
  },
  {
    rule: "only the author takes its pending proposal back",
    snapshot: { ...negotiating, pendingProposalBy: "recipient" },
    capacity: "recipient",
    viewer: { ...observer, ownsPendingProposal: true },
    includes: ["withdraw"],
    excludes: ["accept", "propose"],
  },
  {
    rule: "the other side answers the pending proposal before publishing or signing",
    snapshot: { ...negotiating, pendingProposalBy: "recipient", publicationNeeded: true },
    capacity: "staff",
    includes: ["accept", "counter", "reject"],
    excludes: ["propose", "request_signatures", "publish", "withdraw"],
  },
  {
    rule: "an observer may only message during signing",
    snapshot: signing,
    capacity: "recipient",
    viewer: observer,
    exactly: ["message", "download"],
  },
  {
    rule: "a required signer may sign or propose during signing",
    snapshot: signing,
    capacity: "recipient",
    viewer: signer,
    includes: ["sign", "propose"],
  },
  {
    rule: "staff cancel explicitly instead of proposing during signing",
    snapshot: signing,
    capacity: "staff",
    includes: ["cancel_signatures", "void"],
    excludes: ["propose", "publish", "save_draft", "set_signer"],
  },
  {
    rule: "a signed agreement only downloads",
    snapshot: { ...negotiating, status: "signed" },
    capacity: "staff",
    exactly: ["download"],
  },
  {
    rule: "a signed agreement only downloads for recipients too",
    snapshot: { ...negotiating, status: "signed" },
    capacity: "recipient",
    viewer: signer,
    exactly: ["download"],
  },
  {
    rule: "nothing voids or edits a finalizing round",
    snapshot: { ...signing, round: "finalizing" },
    capacity: "staff",
    exactly: ["message", "download"],
  },
  {
    rule: "recipients cannot see an agreement before its first revision",
    snapshot: { ...negotiating, status: "draft", hasRevision: false },
    capacity: "recipient",
    viewer: signer,
    exactly: [],
  },
];

it("derives every action from lifecycle state and capacity", () => {
  for (const row of rows) {
    const actions = allowedActions(row.snapshot, row.capacity, row.viewer ?? observer);
    for (const action of row.includes ?? []) expect(actions, row.rule).toContain(action);
    for (const action of row.excludes ?? []) expect(actions, row.rule).not.toContain(action);
    if (row.exactly) expect([...actions].sort(), row.rule).toEqual([...row.exactly].sort());
    if (row.capacity === "recipient") {
      expect(
        actions.filter((action) => STAFF_ONLY_ACTIONS.includes(action)),
        row.rule,
      ).toEqual([]);
    }
  }
});
