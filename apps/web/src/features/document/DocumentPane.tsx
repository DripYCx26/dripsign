import type { AgreementView, Capacity } from "@dripsign/core/types";
import { fileUrl } from "@/features/files";
import { EmptyState, Notice } from "@/ui";
import { DraftEditor } from "./DraftEditor.tsx";
import styles from "./DocumentPane.module.css";
import { OlderRevisionBanner } from "./OlderRevisionBanner.tsx";
import { PdfView } from "./PdfView.tsx";
import { ReadingView } from "./ReadingView.tsx";
import { RevisionSwitcher, type RevisionOption } from "./RevisionSwitcher.tsx";
import {
  draftIsAhead,
  peopleFor,
  resolveTarget,
  targetFields,
  targetHasPdf,
  targetSignerIds,
  targetSource,
  type DocumentTarget,
} from "./target.ts";
import { ViewToggle } from "./ViewToggle.tsx";

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DRAFT_VALUE = "draft";

function revisionOptions(view: AgreementView, capacity: Capacity): RevisionOption[] {
  const current = view.agreement.currentRevisionNumber;
  const published = [...view.revisions]
    .sort((a, b) => b.number - a.number)
    .map((revision) => ({
      value: String(revision.number),
      label:
        revision.number === current
          ? `Revision ${String(revision.number)} · current`
          : `Revision ${String(revision.number)} · ${DAY.format(new Date(revision.publishedAt))}`,
    }));
  return draftIsAhead(view, capacity)
    ? [{ value: DRAFT_VALUE, label: "Draft (private)" }, ...published]
    : published;
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

function PreparationNotice({ target }: Readonly<{ target: DocumentTarget }>) {
  if (target.kind !== "draft") return null;
  const { status, error } = target.draft.preparation;
  if (status === "failed") {
    return (
      <Notice tone="stop" live="alert">
        {`The PDF couldn’t be prepared.${error === null ? "" : ` ${error}`}`}
      </Notice>
    );
  }
  if (status === "preparing") {
    return (
      <Notice tone="info" live="polite">
        Preparing PDF… It appears here when it’s ready.
      </Notice>
    );
  }
  return null;
}

function Body({
  view,
  capacity,
  target,
}: Readonly<{ view: AgreementView; capacity: Capacity; target: DocumentTarget }>) {
  const source = targetSource(target);
  const pdf = targetHasPdf(target) ? (
    <PdfView
      src={pdfSrc(view, capacity, target)}
      fields={targetFields(target)}
      viewerRecipientId={view.viewer.recipientId}
      people={view.recipients.map(({ id, name }) => ({ id, name }))}
    />
  ) : null;
  if (source === null) return pdf ?? <PreparationNotice target={target} />;
  const reading = (
    <ReadingView source={source} signers={peopleFor(view, targetSignerIds(target))} />
  );
  if (pdf === null) {
    return (
      <div className={styles.stack}>
        <PreparationNotice target={target} />
        {reading}
      </div>
    );
  }
  return <ViewToggle reading={reading} pdf={pdf} />;
}

/**
 * The document beside the thread: which revision (or the private draft, for staff), the reading
 * view and the exact PDF, and the draft editor when the viewer may save the draft. `rev` comes
 * from the `?rev=` parameter; one that names no revision falls back to the default.
 */
export function DocumentPane({
  view,
  capacity,
  rev,
}: Readonly<{ view: AgreementView; capacity: Capacity; rev?: number | undefined }>) {
  const target = resolveTarget(view, capacity, rev);
  if (target === null) return <EmptyState message="This agreement has no document yet." />;
  const current = view.agreement.currentRevisionNumber;
  const options = revisionOptions(view, capacity);
  const currentRevision = view.revisions.find((revision) => revision.number === current);
  const body = <Body view={view} capacity={capacity} target={target} />;
  const editable =
    view.allowedActions.includes("save_draft") &&
    (target.kind === "draft" || (target.isCurrent && !draftIsAhead(view, capacity)));
  return (
    <div className={styles.pane}>
      <RevisionSwitcher
        options={options}
        value={selectedValue(target)}
        defaultValue={options[0]?.value ?? ""}
      />
      {target.kind === "revision" && !target.isCurrent && current !== null && (
        <OlderRevisionBanner
          viewing={target.revision.number}
          current={current}
          viewingSource={target.revision.source}
          currentSource={currentRevision?.source ?? null}
        />
      )}
      {editable ? <DraftEditor view={view}>{body}</DraftEditor> : body}
    </div>
  );
}
