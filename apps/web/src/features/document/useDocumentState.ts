"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import { useState } from "react";
import type { RunCommand } from "@/features/workspace/commands.ts";
import {
  draftIsAhead,
  resolveTarget,
  targetSha,
  targetSource,
  type DocumentTarget,
} from "./target.ts";
import { useDraftEdit } from "./useDraftEdit.ts";

export type DocumentMode = "reading" | "pdf";

export interface RevisionOption {
  readonly value: string;
  readonly label: string;
}

const DRAFT_VALUE = "draft";

function revisionOptions(view: AgreementView, capacity: Capacity): RevisionOption[] {
  const current = view.agreement.currentRevisionNumber;
  const published = [...view.revisions]
    .sort((a, b) => b.number - a.number)
    .map((revision) => ({
      value: String(revision.number),
      label: `Revision ${String(revision.number)}${revision.number === current ? " · current" : ""}`,
    }));
  const options = draftIsAhead(view, capacity)
    ? [{ value: DRAFT_VALUE, label: "Draft (private)" }, ...published]
    : published;
  // One revision alone is not "current" of anything.
  const only = options.length === 1 ? options[0] : undefined;
  return only === undefined || only.value === DRAFT_VALUE
    ? options
    : [{ ...only, label: `Revision ${only.value}` }];
}

function selectedValue(target: DocumentTarget): string {
  return target.kind === "draft" ? DRAFT_VALUE : String(target.revision.number);
}

/** The viewer may save the draft, and is looking at it (or at the revision it would replace). */
function canEditDocument(view: AgreementView, capacity: Capacity, target: DocumentTarget) {
  return (
    view.allowedActions.includes("save_draft") &&
    (target.kind === "draft" || (target.isCurrent && !draftIsAhead(view, capacity)))
  );
}

/**
 * Everything the document's controls (in the workspace header) and its pane (beside the thread)
 * share, held once by the workspace: which revision, Reading or PDF, and the draft's edit
 * session. `rev` comes from the `?rev=` parameter; one that names no revision falls
 * back to the default, and a view with nothing to show has a null `target`.
 */
export function useDocumentState(
  view: AgreementView,
  capacity: Capacity,
  rev: number | undefined,
  run: RunCommand,
) {
  const target = resolveTarget(view, capacity, rev);
  const draft = useDraftEdit(view, run);
  const [mode, setModeState] = useState<DocumentMode>("reading");
  // The PDF is built only once it is first chosen, then kept so switching back does not reload it.
  const [pdfOpened, setPdfOpened] = useState(false);
  const options = revisionOptions(view, capacity);
  const hasBothForms =
    target !== null && targetSource(target) !== null && targetSha(target) !== null;
  return {
    target,
    draft,
    options,
    /** The option shown when the address has no `rev`; choosing it clears the parameter. */
    defaultValue: options[0]?.value ?? "",
    value: target === null ? "" : selectedValue(target),
    mode,
    pdfOpened,
    /** The form on show; null when the document has one form, or while it is being edited. */
    switchableMode: hasBothForms && draft.edit === null ? mode : null,
    setMode: (next: DocumentMode) => {
      setModeState(next);
      if (next === "pdf") setPdfOpened(true);
    },
    editable: target !== null && canEditDocument(view, capacity, target),
    /** The viewer may propose a change, and this is the revision a proposal would be based on. */
    suggestable:
      view.allowedActions.includes("propose") && target?.kind === "revision" && target.isCurrent,
  };
}

export type DocumentState = ReturnType<typeof useDocumentState>;
