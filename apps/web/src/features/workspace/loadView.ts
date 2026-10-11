import "server-only";
import { loadAgreementView } from "@dripsign/core/domain/view";
import { isDomainError } from "@dripsign/core/errors";
import type { Actor, AgreementView } from "@dripsign/core/types";

/** The view for a workspace page; null when the agreement is not available to this actor. */
export async function loadWorkspaceView(
  actor: Actor,
  agreementId: string,
): Promise<AgreementView | null> {
  try {
    return await loadAgreementView(actor, agreementId);
  } catch (error) {
    if (isDomainError(error) && error.code === "not_found") return null;
    throw error;
  }
}
