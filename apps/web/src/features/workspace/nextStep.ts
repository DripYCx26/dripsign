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
}>;

/** The element a `scroll` step lands on; the workspace puts this id on it. */
export const DOCUMENT_PANE_ID = "document-pane";

// No step scrolls here any more; the thread still marks its open proposal row with it, and goes
// when that mark does.

const NOTHING: NextStep = { label: "", kind: "none" };

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
  // A proposal waiting on staff comes first: publishing now would leave it based on an old
  // revision. Its card carries the answer, so the header offers nothing.
  if (can(view, "accept")) return NOTHING;
  return staffDraftStep(view);
}

function recipientStep(view: AgreementView): NextStep {
  const round = view.activeRound;
  if (round?.status === "finalizing") return finalizing(round);
  if (can(view, "accept")) return NOTHING;
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
