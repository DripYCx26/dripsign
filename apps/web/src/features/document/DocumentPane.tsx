"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import { fileUrl } from "@/features/files";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { Banner, Button, EmptyState } from "@/ui";
import styles from "./DocumentPane.module.css";
import { DraftForm } from "./DraftForm.tsx";
import { PdfView } from "./PdfView.tsx";
import { ReadingView, type ReadingMeta } from "./ReadingView.tsx";
import {
  peopleFor,
  targetFields,
  targetSha,
  targetSignerIds,
  targetSource,
  type DocumentTarget,
} from "./target.ts";
import type { DocumentMode, DocumentState } from "./useDocumentState.ts";
import { useRevisionParam } from "./useRevisionParam.ts";

type TargetProps = Readonly<{
  view: AgreementView;
  target: DocumentTarget;
  run: RunCommand;
  busy: boolean;
}>;

function pdfSrc(view: AgreementView, capacity: Capacity, target: DocumentTarget): string {
  const id = view.agreement.id;
  if (target.kind === "draft") return fileUrl(id, "draft", { as: "staff" });
  if (target.isCurrent) return fileUrl(id, "current", { as: capacity });
  return fileUrl(id, "revision", { rev: target.revision.number, as: capacity });
}

function readingMeta(view: AgreementView, target: DocumentTarget, candidate = false): ReadingMeta {
  const revision = target.kind === "revision" ? target.revision : null;
  const completed = view.completedRound;
  return {
    org: view.orgName,
    revision: revision?.number ?? null,
    publishedAt: revision?.publishedAt ?? null,
    signedAt: revision !== null && completed?.revisionId === revision.id ? completed.endedAt : null,
    voided: view.agreement.status === "void",
    candidate,
  };
}

/** The assistant's draft on the sheet: apply it, or go back to the draft it would replace. */
function CandidateStrip({
  view,
  doc,
  run,
  busy,
}: Readonly<{ view: AgreementView; doc: DocumentState; run: RunCommand; busy: boolean }>) {
  const { candidate } = doc;
  if (candidate === null) return null;
  const expectedDraftVersion = view.agreement.draftVersion;
  const canApply =
    !candidate.stale && expectedDraftVersion !== null && view.allowedActions.includes("apply_ai");
  return (
    <Banner
      tone={candidate.stale ? "attention" : "info"}
      live={candidate.stale ? "polite" : undefined}
      action={
        <>
          {canApply && (
            <Button
              variant="ink"
              size="sm"
              loading={busy}
              onClick={() => {
                void run(
                  {
                    kind: "apply_ai",
                    expectedDraftVersion,
                    suggestionId: candidate.id,
                  },
                  `apply_ai:${candidate.id}`,
                );
              }}
            >
              Apply draft
            </Button>
          )}
          <Button variant="quiet" size="sm" onClick={doc.hideCandidate}>
            Show current
          </Button>
        </>
      }
    >
      {candidate.stale
        ? "This candidate no longer matches the draft"
        : "Candidate draft from the assistant · not applied"}
    </Banner>
  );
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
              void run({ kind: "retry_preparation" }, "retry_preparation");
            }}
          >
            Retry
          </Button>
        )
      }
    >
      {error ?? "The PDF couldn’t be prepared."}
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

/** The reading view, and the PDF beside it once there is one. */
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
  const reading = (
    <ReadingView
      source={source}
      meta={readingMeta(view, target)}
      signers={signersWithSignatures(view, target)}
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

type PaneProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
  /** The workspace's one command channel: a command in flight at a time. */
  run: RunCommand;
  busy: boolean;
  /** The document's state, held by the workspace so the header's controls share it. */
  doc: DocumentState;
}>;

/** What fills the sheet: the assistant's candidate, the draft's form, or the document itself. */
function Surface({ doc, target, ...pane }: PaneProps & Readonly<{ target: DocumentTarget }>) {
  const { view, capacity, busy } = pane;
  if (doc.candidateShown && doc.candidate !== null) {
    return (
      <ReadingView
        source={doc.candidate.source}
        meta={readingMeta(view, target, true)}
        signers={signersWithSignatures(view, target)}
        suggestable={false}
      />
    );
  }
  if (doc.draft.edit !== null) {
    return (
      <DraftForm
        edit={doc.draft.edit}
        onEdit={doc.draft.change}
        pending={busy}
        message={doc.draft.problem}
      />
    );
  }
  return (
    <Body
      view={view}
      capacity={capacity}
      target={target}
      mode={doc.mode}
      pdfOpened={doc.pdfOpened}
      suggestable={doc.suggestable}
    />
  );
}

function LoadedPane({ doc, target, ...pane }: PaneProps & Readonly<{ target: DocumentTarget }>) {
  const { view, run, busy } = pane;
  return (
    <div className={styles.pane}>
      {doc.candidateShown ? (
        <CandidateStrip view={view} doc={doc} run={run} busy={busy} />
      ) : (
        <Strip view={view} target={target} run={run} busy={busy} />
      )}
      <div className={styles.body}>
        <Surface doc={doc} target={target} {...pane} />
      </div>
    </div>
  );
}

/**
 * The document beside the thread: the reading view and the exact PDF, and the draft's editing
 * form. Which revision, Reading or PDF, and the draft's actions are `DocumentControls`, in the
 * workspace header.
 */
export function DocumentPane({ doc, ...pane }: PaneProps) {
  if (doc.target === null) return <EmptyState message="This agreement has no document yet." />;
  return <LoadedPane {...pane} doc={doc} target={doc.target} />;
}

/** Signers of the target, each with their signature when the live or completed round on this revision holds one. */
function signersWithSignatures(view: AgreementView, target: DocumentTarget) {
  const revisionId = target.kind === "revision" ? target.revision.id : null;
  const round = [view.completedRound, view.activeRound].find(
    (item) => item !== null && item.revisionId === revisionId,
  );
  return peopleFor(view, targetSignerIds(target)).map((person) => ({
    ...person,
    signature: round?.signers.find((s) => s.recipientId === person.id)?.signature ?? null,
  }));
}
