import type { Draft, DocumentSource, SigningField } from "@dripsign/core/schema";
import type { AgreementView, Capacity, RevisionView } from "@dripsign/core/types";

/** What the document pane is showing: the private draft or one published revision. */
export type DocumentTarget =
  | Readonly<{ kind: "draft"; draft: Draft }>
  | Readonly<{ kind: "revision"; revision: RevisionView; isCurrent: boolean }>;

/** Staff see their draft by default while it holds changes no revision has yet. */
export function draftIsAhead(view: AgreementView, capacity: Capacity): boolean {
  return (
    capacity === "staff" &&
    view.draft !== null &&
    (view.agreement.currentRevisionNumber === null || view.agreement.publicationNeeded)
  );
}

export function resolveTarget(
  view: AgreementView,
  capacity: Capacity,
  rev: number | undefined,
): DocumentTarget | null {
  const currentNumber = view.agreement.currentRevisionNumber;
  const pick = (number: number | null | undefined): DocumentTarget | null => {
    const revision = view.revisions.find((item) => item.number === number);
    return revision === undefined
      ? null
      : { kind: "revision", revision, isCurrent: revision.number === currentNumber };
  };
  const asked = pick(rev);
  if (asked !== null) return asked;
  if (draftIsAhead(view, capacity) && view.draft !== null) {
    return { kind: "draft", draft: view.draft };
  }
  return pick(currentNumber);
}

export function targetSource(target: DocumentTarget): DocumentSource | null {
  return target.kind === "draft" ? target.draft.source : target.revision.source;
}

export function targetFields(target: DocumentTarget): readonly SigningField[] {
  return target.kind === "draft" ? target.draft.signingFields : target.revision.signingFields;
}

export function targetSignerIds(target: DocumentTarget): readonly string[] {
  return target.kind === "draft" ? target.draft.signerIds : target.revision.signerIds;
}

/**
 * The SHA-256 of the PDF to show, which is also what a viewer of it is keyed by. The draft's PDF
 * exists once preparation is ready; a revision's always does.
 */
export function targetSha(target: DocumentTarget): string | null {
  if (target.kind === "revision") return target.revision.sha256;
  return target.draft.preparation.status === "ready"
    ? (target.draft.document?.sha256 ?? null)
    : null;
}

/** Recipients by id, in the order of `ids`; an id with no recipient row is dropped. */
export function peopleFor(view: AgreementView, ids: readonly string[]) {
  return ids.flatMap((id) => {
    const recipient = view.recipients.find((item) => item.id === id);
    return recipient === undefined ? [] : [{ id, name: recipient.name }];
  });
}
