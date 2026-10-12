import type { SigningField } from "@dripsign/core/schema";
import type { AgreementView, RevisionView } from "@dripsign/core/types";
import { fileUrl } from "@/features/files";
import { Notice, Pill } from "@/ui";
import { CopyHash } from "./CopyHash.tsx";
import { PdfView } from "./PdfView.tsx";
import styles from "./PublishReview.module.css";
import { PublishAction } from "./PublishAction.tsx";
import { SectionDiff } from "./SectionDiff.tsx";

const SHORT_LENGTH = 12;

function fieldWords(fields: readonly SigningField[]): string {
  if (fields.length === 0) return "No signature field";
  const types = fields.map((field) => (field.type === "signature" ? "Signature" : "Date"));
  const pages = [...new Set(fields.map((field) => field.page))];
  return `${types.join(", ")} · ${pages.length === 1 ? "page" : "pages"} ${pages.join(", ")}`;
}

/** One quiet line under the PDF's toolbar: who signs, which fields, and who stopped signing. */
function SignerFields({
  view,
  previous,
}: Readonly<{ view: AgreementView; previous: RevisionView | undefined }>) {
  const draft = view.draft;
  if (draft === null) return null;
  const nameOf = (id: string) => view.recipients.find((item) => item.id === id)?.name ?? "Signer";
  const removed = (previous?.signerIds ?? []).filter((id) => !draft.signerIds.includes(id));
  return (
    <ul className={styles.signers} aria-label="Signature fields">
      {draft.signerIds.length === 0 && <li>No required signers.</li>}
      {draft.signerIds.map((id) => {
        const fields = draft.signingFields.filter((field) => field.recipientId === id);
        const isNew = previous !== undefined && !previous.signerIds.includes(id);
        return (
          <li key={id}>
            {`${nameOf(id)} — ${fieldWords(fields)}`}
            {isNew && <Pill tone="info">New signer</Pill>}
          </li>
        );
      })}
      {removed.length > 0 && <li>{`No longer signing: ${removed.map(nameOf).join(", ")}.`}</li>}
    </ul>
  );
}

function PdfChange({
  draftPages,
  draftSha,
  previous,
}: Readonly<{ draftPages: number; draftSha: string; previous: RevisionView }>) {
  if (previous.sha256 === draftSha) {
    return <p className={styles.muted}>The PDF is the same as revision {previous.number}.</p>;
  }
  return (
    <dl className={styles.facts}>
      <dt>{`Revision ${String(previous.number)} PDF`}</dt>
      <dd>{`${String(previous.pageCount)} pages · ${previous.sha256.slice(0, SHORT_LENGTH)}`}</dd>
      <dt>Draft PDF</dt>
      <dd>{`${String(draftPages)} pages · ${draftSha.slice(0, SHORT_LENGTH)}`}</dd>
    </dl>
  );
}

function WhatChanged({
  draft,
  document,
  previous,
}: Readonly<{
  draft: NonNullable<AgreementView["draft"]>;
  document: { readonly pageCount: number; readonly sha256: string };
  previous: RevisionView;
}>) {
  if (draft.source === null) {
    return (
      <PdfChange draftPages={document.pageCount} draftSha={document.sha256} previous={previous} />
    );
  }
  return <SectionDiff before={previous.source} after={draft.source} />;
}

/**
 * The last look before a revision is published: what changed since the current revision (a first
 * revision has nothing to compare), and the exact PDF that will be published with its SHA and who
 * signs where. Publishing needs the reviewer's word that they read the PDF, and a different PDF
 * asks for it again.
 */
export function PublishReview({ view }: Readonly<{ view: AgreementView }>) {
  const { draft } = view;
  const document = draft?.document ?? null;
  if (draft === null || document === null || draft.preparation.status !== "ready") {
    const failed = draft?.preparation.status === "failed";
    return (
      <Notice tone="attention">
        {failed
          ? "The PDF couldn’t be prepared, so it can’t be published."
          : "The PDF is still being prepared. Come back when it’s ready."}
      </Notice>
    );
  }
  if (!view.allowedActions.includes("publish")) {
    return <Notice tone="attention">There’s nothing to publish right now.</Notice>;
  }
  const currentNumber = view.agreement.currentRevisionNumber;
  const previous = view.revisions.find((revision) => revision.number === currentNumber);
  const number = (currentNumber ?? 0) + 1;
  const isFirst = previous === undefined;
  return (
    <div className={styles.review}>
      {previous !== undefined && (
        <section className={styles.changes} aria-labelledby="what-changed">
          <h2 id="what-changed">{`What changed since revision ${String(previous.number)}`}</h2>
          <WhatChanged draft={draft} document={document} previous={previous} />
        </section>
      )}
      <section aria-label="The PDF that will be published">
        <PdfView
          src={fileUrl(view.agreement.id, "draft", { as: "staff" })}
          sha256={document.sha256}
          fields={draft.signingFields}
          viewerRecipientId={null}
          people={view.recipients.map(({ id, name }) => ({ id, name }))}
          lead={<CopyHash sha256={document.sha256} label="SHA-256" />}
          note={<SignerFields view={view} previous={previous} />}
        />
      </section>
      <PublishAction
        // A different PDF is a new review: the checkbox starts unchecked.
        key={document.sha256}
        view={view}
        reviewedSha256={document.sha256}
        number={number}
        isFirst={isFirst}
      />
    </div>
  );
}
