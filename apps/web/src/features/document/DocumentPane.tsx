"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fileUrl } from "@/features/files";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { Banner, Button, EmptyState } from "@/ui";
import { DocumentHeader, type DocumentMode, type RevisionOption } from "./DocumentHeader.tsx";
import styles from "./DocumentPane.module.css";
import { DraftForm } from "./DraftForm.tsx";
import { PdfReplacer } from "./PdfReplacer.tsx";
import { PdfView } from "./PdfView.tsx";
import { ReadingView } from "./ReadingView.tsx";
import {
  draftIsAhead,
  peopleFor,
  resolveTarget,
  targetFields,
  targetSha,
  targetSignerIds,
  targetSource,
  type DocumentTarget,
} from "./target.ts";
import { useDraftEdit, type DraftEdit } from "./useDraftEdit.ts";
import { useRevisionParam } from "./useRevisionParam.ts";

const DRAFT_VALUE = "draft";

type PaneProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
  /** The workspace's one command channel: a command in flight at a time. */
  run: RunCommand;
  busy: boolean;
}>;

type TargetProps = PaneProps & Readonly<{ target: DocumentTarget }>;

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

function pdfSrc(view: AgreementView, capacity: Capacity, target: DocumentTarget): string {
  const id = view.agreement.id;
  if (target.kind === "draft") return fileUrl(id, "draft", { as: "staff" });
  if (target.isCurrent) return fileUrl(id, "current", { as: capacity });
  return fileUrl(id, "revision", { rev: target.revision.number, as: capacity });
}

/** The one line above the document when it is an older revision or the draft's PDF is not ready. */
function Strip({ view, target, run, busy }: TargetProps) {
  const showCurrent = useRevisionParam();
  if (target.kind === "revision") {
    if (target.isCurrent) return null;
    return (
      <Banner
        action={
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              showCurrent(null);
            }}
          >
            Show current
          </Button>
        }
      >
        {`Viewing revision ${String(target.revision.number)}`}
      </Banner>
    );
  }
  const { status, error } = target.draft.preparation;
  if (status === "preparing") {
    return <Banner live="polite">Preparing PDF…</Banner>;
  }
  if (status !== "failed") return null;
  return (
    <Banner
      tone="stop"
      live="alert"
      action={
        view.allowedActions.includes("retry_preparation") && (
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => {
              void run(
                { kind: "retry_preparation", expectedVersion: view.agreement.version },
                "retry_preparation",
              );
            }}
          >
            Retry
          </Button>
        )
      }
    >
      {`The PDF couldn’t be prepared.${error === null ? "" : ` ${error}`}`}
    </Banner>
  );
}

type BodyProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
  target: DocumentTarget;
  mode: DocumentMode;
  /** The PDF is built only once it is first chosen, then kept so switching back does not reload it. */
  pdfOpened: boolean;
  /** The viewer may propose a change, and this is the revision a proposal would be based on. */
  suggestable: boolean;
}>;

/** The reading view and the PDF, whichever the document has; both when it has both. */
function Body({ view, capacity, target, mode, pdfOpened, suggestable }: BodyProps) {
  const source = targetSource(target);
  const sha256 = targetSha(target);
  const pdf =
    sha256 === null ? null : (
      <PdfView
        src={pdfSrc(view, capacity, target)}
        sha256={sha256}
        fields={targetFields(target)}
        viewerRecipientId={view.viewer.recipientId}
        people={view.recipients.map(({ id, name }) => ({ id, name }))}
      />
    );
  if (source === null) return pdf;
  const reading = (
    <ReadingView
      source={source}
      signers={peopleFor(view, targetSignerIds(target))}
      suggestable={suggestable}
    />
  );
  if (pdf === null) return reading;
  return (
    <>
      <div hidden={mode !== "reading"}>{reading}</div>
      {pdfOpened && <div hidden={mode !== "pdf"}>{pdf}</div>}
    </>
  );
}

type DraftActionsProps = Readonly<{
  draft: DraftEdit;
  busy: boolean;
  /** The draft is an uploaded file: it is replaced, not edited. */
  uploaded: boolean;
  replacing: boolean;
  onReplacing: (open: boolean) => void;
}>;

/** Edit draft, or Save and Discard while the form is open; for an uploaded PDF, Replace PDF. */
function DraftActions({ draft, busy, uploaded, replacing, onReplacing }: DraftActionsProps) {
  if (uploaded) {
    return (
      <Button
        variant="secondary"
        size="sm"
        pressed={replacing}
        onClick={() => {
          onReplacing(!replacing);
        }}
      >
        Replace PDF
      </Button>
    );
  }
  if (draft.edit === null) {
    return (
      <Button variant="secondary" size="sm" onClick={draft.begin}>
        Edit draft
      </Button>
    );
  }
  return (
    <>
      <Button variant="quiet" size="sm" disabled={busy} onClick={draft.discard}>
        Discard
      </Button>
      <Button
        variant="ink"
        size="sm"
        loading={busy}
        disabled={!draft.dirty}
        onClick={() => void draft.save()}
      >
        Save
      </Button>
    </>
  );
}

/** The viewer may save the draft, and is looking at it (or at the revision it would replace). */
function canEditDocument(view: AgreementView, capacity: Capacity, target: DocumentTarget) {
  return (
    view.allowedActions.includes("save_draft") &&
    (target.kind === "draft" || (target.isCurrent && !draftIsAhead(view, capacity)))
  );
}

function LoadedPane(props: TargetProps) {
  const { view, capacity, target, run, busy } = props;
  const router = useRouter();
  const draft = useDraftEdit(view, run);
  const [mode, setMode] = useState<DocumentMode>("reading");
  const [pdfOpened, setPdfOpened] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const options = revisionOptions(view, capacity);
  const editable = canEditDocument(view, capacity, target);
  const uploaded = (view.draft?.upload ?? null) !== null;
  const both = targetSource(target) !== null && targetSha(target) !== null;
  const suggestable =
    view.allowedActions.includes("propose") && target.kind === "revision" && target.isCurrent;
  return (
    <div className={styles.pane}>
      <DocumentHeader
        options={options}
        value={selectedValue(target)}
        defaultValue={options[0]?.value ?? ""}
        mode={both && draft.edit === null ? mode : null}
        onMode={(next) => {
          setMode(next);
          if (next === "pdf") setPdfOpened(true);
        }}
        locked={draft.edit !== null}
        actions={
          editable && (
            <DraftActions
              draft={draft}
              busy={busy}
              uploaded={uploaded}
              replacing={replacing}
              onReplacing={setReplacing}
            />
          )
        }
      />
      <Strip {...props} />
      <div className={styles.body}>
        {editable && uploaded && replacing && (
          <PdfReplacer
            agreementId={view.agreement.id}
            version={view.agreement.version}
            onUploaded={() => {
              setReplacing(false);
              router.refresh();
            }}
          />
        )}
        {draft.edit === null ? (
          <Body
            view={view}
            capacity={capacity}
            target={target}
            mode={mode}
            pdfOpened={pdfOpened}
            suggestable={suggestable}
          />
        ) : (
          <DraftForm
            edit={draft.edit}
            onEdit={draft.change}
            pending={busy}
            message={draft.problem}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The document beside the thread: which revision (or the private draft, for staff), the reading
 * view and the exact PDF, and the draft's editing. `rev` comes from the `?rev=` parameter; one
 * that names no revision falls back to the default.
 */
export function DocumentPane({ rev, ...pane }: PaneProps & Readonly<{ rev?: number | undefined }>) {
  const target = resolveTarget(pane.view, pane.capacity, rev);
  if (target === null) return <EmptyState message="This agreement has no document yet." />;
  return <LoadedPane {...pane} target={target} />;
}
