import type { AgreementView } from "@dripsign/core/types";

/** What the sign route shows for this viewer, decided once from the live view. */
export type SignPageState = "sign" | "signed" | "finalizing" | "completed" | "void" | "closed";

export function signPageState(view: AgreementView): SignPageState {
  if (view.agreement.status === "void") return "void";
  if (view.agreement.status === "signed" && view.completedRound !== null) return "completed";
  if (view.activeRound?.status === "finalizing") return "finalizing";
  if (view.allowedActions.includes("sign")) return "sign";
  if (view.viewer.hasSigned) return "signed";
  return "closed";
}
