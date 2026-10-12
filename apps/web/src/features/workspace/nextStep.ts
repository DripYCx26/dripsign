import type { Command, PreparationStatus } from "@dripsign/core/schema";
import type {
  AgreementAction,
  AgreementStatus,
  AgreementView,
  Capacity,
  RoundView,
} from "@dripsign/core/types";
import { fileUrl } from "../files.ts";

export type NextStepKind = "command" | "navigate" | "none";

/**
 * The one primary action of a workspace, decided from the live view. `none` with a `chip` is a
 * status, with an empty label it is nothing to show.
 */
export type NextStep = Readonly<{
  label: string;
  kind: NextStepKind;
  command?: Command;
  href?: string;
  disabled?: boolean;
  chip?: string;
}>;

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

/** What a staff list row and the staff workspace both read to name the next step. */
export type StaffFacts = Readonly<{
  status: AgreementStatus;
  preparation: PreparationStatus;
  /** Live required signers in the draft. */
  requiredSigners: number;
  allowedActions: readonly AgreementAction[];
}>;

/**
 * Staff's next move outside a signature request, from the policy's allowed actions: the one rule
 * the list row and the workspace header both word. `none` is nothing to do or say.
 */
export type StaffMove =
  | "answer"
  | "preparing"
  | "retry"
  | "publish"
  | "request_signatures"
  | "needs_signer"
  | "awaiting_answer"
  | "none";

export function staffMove(facts: StaffFacts): StaffMove {
  const can = (action: AgreementAction) => facts.allowedActions.includes(action);
  const editable = facts.status === "draft" || facts.status === "negotiating";
  if (!editable) return "none";
  if (can("accept")) return "answer";
  if (facts.preparation === "preparing") return "preparing";
  if (can("retry_preparation")) return "retry";
  if (can("publish")) return "publish";
  if (can("request_signatures")) return "request_signatures";
  if (facts.preparation === "ready" && facts.requiredSigners === 0) return "needs_signer";
  if (can("withdraw")) return "awaiting_answer";
  return "none";
}

/**
 * The words of a staff move; publishing says whether recipients have seen a revision before. An
 * answer has none here: the proposal's card carries it, and a list row names its author.
 */
export function staffMoveLabel(move: StaffMove, status: AgreementStatus): string {
  switch (move) {
    case "preparing":
      return "Preparing PDF…";
    case "retry":
      return "Retry preparation";
    case "publish":
      return status === "draft" ? "Review and publish" : "Review and publish changes";
    case "request_signatures":
      return "Request signatures";
    case "needs_signer":
      return "Needs a required signer";
    case "awaiting_answer":
      return "Waiting for recipients to respond";
    case "answer":
    case "none":
      return "";
  }
}

function staffFacts(view: AgreementView): StaffFacts {
  return {
    status: view.agreement.status,
    preparation: view.agreement.preparation?.status ?? "preparing",
    requiredSigners: view.recipients.filter((r) => r.isSigner && r.removedAt === null).length,
    allowedActions: view.allowedActions,
  };
}

/** Staff, while no round is live. A proposal's card carries its answer, and its author's wait. */
function staffDraftStep(view: AgreementView): NextStep {
  const { status, version } = view.agreement;
  const move = staffMove(staffFacts(view));
  const label = staffMoveLabel(move, status);
  switch (move) {
    case "preparing":
      return { label, kind: "none", disabled: true };
    case "retry":
      return {
        label,
        kind: "command",
        command: { kind: "retry_preparation", expectedVersion: version },
      };
    case "publish":
      return { label, kind: "navigate", href: `/staff/agreements/${view.agreement.id}/publish` };
    case "request_signatures":
      return {
        label,
        kind: "command",
        command: { kind: "request_signatures", expectedVersion: version },
      };
    case "needs_signer":
      return {
        label: staffMoveLabel("publish", status),
        kind: "none",
        disabled: true,
        chip: label,
      };
    case "answer":
    case "awaiting_answer":
    case "none":
      return NOTHING;
  }
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
