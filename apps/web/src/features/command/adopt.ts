import type { AgreementView } from "@dripsign/core/types";
import type { ActionFailure, ActionResult } from "@/server/action";

export interface Scope {
  readonly agreementId: string;
  /** The server view this scope last adopted; a new one (navigation, refresh) replaces local state. */
  readonly source: AgreementView;
  readonly view: AgreementView;
  readonly error: ActionFailure | null;
}

/** What a request saw when it started: its order, and the committed workspace and source. */
export interface Started {
  readonly ticket: number;
  readonly agreementId: string;
  readonly source: AgreementView;
  /** A background reload leaves the error shown by the request that triggered it. */
  readonly keepError: boolean;
}

/**
 * The scope after a response lands. `latest` is the newest ticket when the response arrived, read
 * outside the updater because React may run the updater after a later request has started.
 * A view is applied only while the source it started from is still adopted, so an older read never
 * replaces newer server data; a failure still surfaces so an uncertain write is never hidden.
 */
export function adoptRead(
  current: Scope,
  started: Started,
  latest: number,
  result: ActionResult<AgreementView>,
): Scope {
  const { ticket, agreementId, source, keepError } = started;
  if (ticket !== latest || current.agreementId !== agreementId) return current;
  if (!result.ok) return keepError ? current : { ...current, error: result };
  if (current.source !== source) return current;
  return { ...current, view: result.value, error: keepError ? current.error : null };
}
