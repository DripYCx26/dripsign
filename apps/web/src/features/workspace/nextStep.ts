import type { Command } from "@dripsign/core/schema";
import type { AgreementAction, AgreementView, Capacity, RoundView } from "@dripsign/core/types";
import { fileUrl } from "../files.ts";

export type NextStepKind = "command" | "navigate" | "scroll" | "none";

/**
 * The one primary action of a workspace, decided from the live view. `scroll` targets an in-page
 * anchor in `href`; `none` with a `chip` is a status, with an empty label it is nothing to show.
 */
export type NextStep = Readonly<{
  label: string;
  kind: NextStepKind;
  command?: Command;
  href?: string;
  disabled?: boolean;
  chip?: string;
  /** Shown only where the chat is a tab of its own (under 1024 px); beside it the card answers. */
  narrowOnly?: boolean;
}>;

/** The elements a `scroll` step lands on; the thread and the workspace put these ids on them. */
export const PENDING_PROPOSAL_ID = "pending-proposal";
export const DOCUMENT_PANE_ID = "document-pane";

const NOTHING: NextStep = { label: "", kind: "none" };
const RESPOND: NextStep = {
  label: "Respond to proposal",
  kind: "scroll",
  href: `#${PENDING_PROPOSAL_ID}`,
  narrowOnly: true,
};

function can(view: AgreementView, action: AgreementAction): boolean {
  return view.allowedActions.includes(action);
}

function signedCount(round: RoundView): number {
  return round.signers.filter((signer) => signer.signature !== null).length;
}

function finalizing(round: RoundView): NextStep {
  const label = round.finalizingDelayed
    ? "Preparing signed files (delayed)"
    : "Preparing signed files…";
  return { label, kind: "none", disabled: true };
}

function download(view: AgreementView, capacity: Capacity): NextStep {
  return {
    label: "Download signed PDF",
    kind: "navigate",
    href: fileUrl(view.agreement.id, "signed", { as: capacity }),
  };
}

/** Staff, while the agreement is a draft or in review and no round is live. */
function staffDraftStep(view: AgreementView): NextStep {
  const { preparation, status, version } = view.agreement;
  const state = preparation?.status ?? "empty";
  if (state === "preparing") return { label: "Preparing PDF…", kind: "none", disabled: true };
  if (state === "failed" && can(view, "retry_preparation")) {
    return {
      label: "Retry preparation",
      kind: "command",
      command: { kind: "retry_preparation", expectedVersion: version },
    };
  }
  if (state === "empty" && view.agreement.currentRevisionNumber === null) {
    return { label: "Add terms", kind: "scroll", href: `#${DOCUMENT_PANE_ID}` };
  }
  if (can(view, "publish")) {
    return {
      label: status === "draft" ? "Review and publish" : "Review and publish changes",
      kind: "navigate",
      href: `/staff/agreements/${view.agreement.id}/publish`,
    };
  }
  if (can(view, "request_signatures")) {
    return {
      label: "Request signatures",
      kind: "command",
      command: { kind: "request_signatures", expectedVersion: version },
    };
  }
  if (status === "draft" && state === "ready") {
    return {
      label: "Review and publish",
      kind: "none",
      disabled: true,
      chip: "Needs a required signer",
    };
  }
  return NOTHING;
}

function staffStep(view: AgreementView): NextStep {
  const round = view.activeRound;
  if (round?.status === "finalizing") return finalizing(round);
  if (round?.status === "active") {
    return {
      label: "",
      kind: "none",
      chip: `${String(signedCount(round))} of ${String(round.signers.length)} signed`,
    };
  }
  // A proposal waiting on staff comes first: publishing now would leave it based on an old revision.
  if (can(view, "accept")) {
    return RESPOND;
  }
  return staffDraftStep(view);
}

function recipientStep(view: AgreementView): NextStep {
  const round = view.activeRound;
  if (round?.status === "finalizing") return finalizing(round);
  if (can(view, "accept")) {
    return RESPOND;
  }
  if (can(view, "sign")) {
    return {
      label: "Review and sign",
      kind: "navigate",
      href: `/agreements/${view.agreement.id}/sign`,
    };
  }
  if (round?.status === "active" && view.viewer.hasSigned) {
    const waiting = round.signers.length - signedCount(round);
    const others = waiting === 1 ? "1 other" : `${String(waiting)} others`;
    return { label: `You signed · waiting on ${others}`, kind: "none", disabled: true };
  }
  return NOTHING;
}

/** The primary action for `capacity`; the table it implements is the test fixture. */
export function nextStep(capacity: Capacity, view: AgreementView): NextStep {
  const { status } = view.agreement;
  if (status === "void") return NOTHING;
  if (status === "signed") return can(view, "download") ? download(view, capacity) : NOTHING;
  return capacity === "staff" ? staffStep(view) : recipientStep(view);
}
