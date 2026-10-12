// The only home of lifecycle and permission rules. Views return allowedActions; every command
// recomputes it inside its transaction after locking the agreement and refuses what is absent.
import type { PreparationStatus } from "../schema.ts";
import type { AgreementAction, AgreementStatus, Capacity } from "../types.ts";

export interface PolicySnapshot {
  readonly status: AgreementStatus;
  readonly hasRevision: boolean;
  /** `agreement.draft_dirty`: the draft or the signer set differs from the current revision. */
  readonly publicationNeeded: boolean;
  readonly preparation: PreparationStatus;
  /** Live required signers in the draft. */
  readonly draftSignerCount: number;
  readonly pendingProposalBy: Capacity | null;
  readonly round: "active" | "finalizing" | null;
  readonly aiEnabled: boolean;
  readonly readyAiSuggestions: number;
}

export interface PolicyViewer {
  /** Required signer of the live round (recipients only). */
  readonly isRequiredSigner: boolean;
  readonly hasSigned: boolean;
  /** Wrote the pending proposal: any staff member for the staff side, else that recipient. */
  readonly ownsPendingProposal: boolean;
}

export const STAFF_ONLY_ACTIONS: readonly AgreementAction[] = [
  "save_draft",
  "publish",
  "retry_preparation",
  "add_recipient",
  "remove_recipient",
  "resend_invite",
  "set_signer",
  "request_signatures",
  "cancel_signatures",
  "void",
  "ask_ai",
  "apply_ai",
];

// A Record so a new command kind fails to compile until it is ranked here.
const ACTION_RANK: Readonly<Record<AgreementAction, number>> = {
  sign: 0,
  publish: 1,
  request_signatures: 2,
  accept: 3,
  counter: 4,
  reject: 5,
  withdraw: 6,
  propose: 7,
  message: 8,
  save_draft: 9,
  retry_preparation: 10,
  add_recipient: 11,
  remove_recipient: 12,
  set_signer: 13,
  resend_invite: 14,
  cancel_signatures: 15,
  ask_ai: 16,
  apply_ai: 17,
  download: 18,
  void: 19,
};

export function allowedActions(
  snapshot: PolicySnapshot,
  capacity: Capacity,
  viewer: PolicyViewer,
): AgreementAction[] {
  const allowed = new Set<AgreementAction>();
  if (snapshot.hasRevision || (capacity === "staff" && snapshot.preparation === "ready")) {
    allowed.add("download");
  }
  // Recipients never see an agreement before its first revision.
  if (capacity === "recipient" && !snapshot.hasRevision) return [];
  if (snapshot.status === "signed" || snapshot.status === "void") return ordered(allowed);
  // Nothing edits, cancels or voids a finalizing round; talking is still fine.
  if (snapshot.round === "finalizing") {
    allowed.add("message");
    return ordered(allowed);
  }
  if (capacity === "staff") addStaffActions(snapshot, viewer, allowed);
  else addRecipientActions(snapshot, viewer, allowed);
  return ordered(allowed);
}

function addStaffActions(
  snapshot: PolicySnapshot,
  viewer: PolicyViewer,
  allowed: Set<AgreementAction>,
): void {
  const editable = snapshot.status === "draft" || snapshot.status === "negotiating";
  allowed.add("void");
  if (snapshot.hasRevision) {
    allowed.add("message");
    allowed.add("resend_invite");
  }
  if (snapshot.round === "active") {
    // add_recipient here admits observers only; the command refuses a signer.
    allowed.add("add_recipient");
    allowed.add("remove_recipient");
    allowed.add("cancel_signatures");
    return;
  }
  if (editable) addDraftActions(snapshot, allowed);
  if (snapshot.status === "negotiating") {
    addNegotiationActions(snapshot, "staff", viewer, allowed);
  }
  if (
    snapshot.status === "negotiating" &&
    !snapshot.publicationNeeded &&
    snapshot.pendingProposalBy === null
  ) {
    allowed.add("request_signatures");
  }
}

function addDraftActions(snapshot: PolicySnapshot, allowed: Set<AgreementAction>): void {
  allowed.add("save_draft");
  allowed.add("add_recipient");
  allowed.add("remove_recipient");
  allowed.add("set_signer");
  if (snapshot.preparation === "failed") allowed.add("retry_preparation");
  // An open proposal is answered or withdrawn first.
  if (
    snapshot.preparation === "ready" &&
    snapshot.publicationNeeded &&
    snapshot.draftSignerCount > 0 &&
    snapshot.pendingProposalBy === null
  ) {
    allowed.add("publish");
  }
  if (snapshot.aiEnabled) allowed.add("ask_ai");
  if (snapshot.readyAiSuggestions > 0) allowed.add("apply_ai");
}

/**
 * Turn-taking is by side: only the side that did not author the pending proposal answers it, and
 * only its author takes it back.
 */
function addNegotiationActions(
  snapshot: PolicySnapshot,
  capacity: Capacity,
  viewer: PolicyViewer,
  allowed: Set<AgreementAction>,
): void {
  if (snapshot.pendingProposalBy === null) {
    allowed.add("propose");
    return;
  }
  if (snapshot.pendingProposalBy !== capacity) {
    allowed.add("counter");
    allowed.add("accept");
    allowed.add("reject");
  } else if (viewer.ownsPendingProposal) {
    allowed.add("withdraw");
  }
}

function addRecipientActions(
  snapshot: PolicySnapshot,
  viewer: PolicyViewer,
  allowed: Set<AgreementAction>,
): void {
  allowed.add("message");
  if (snapshot.status === "negotiating") {
    addNegotiationActions(snapshot, "recipient", viewer, allowed);
    return;
  }
  // During signing only a required signer may propose, which cancels the round.
  if (snapshot.round === "active" && viewer.isRequiredSigner) {
    if (snapshot.pendingProposalBy === null) allowed.add("propose");
    if (!viewer.hasSigned) allowed.add("sign");
  }
}

function ordered(allowed: ReadonlySet<AgreementAction>): AgreementAction[] {
  return [...allowed].sort((a, b) => ACTION_RANK[a] - ACTION_RANK[b]);
}
