import type { DocumentSource, SigningField } from "@dripsign/core/schema";
import type { AgreementView, RevisionView } from "@dripsign/core/types";
import { fileUrl } from "@/features/files";
import { Notice, Pill } from "@/ui";
import { CopyHash } from "./CopyHash.tsx";
import { PdfView } from "./PdfView.tsx";
import styles from "./PublishReview.module.css";
import { PublishAction } from "./PublishAction.tsx";
import { SectionDiff } from "./SectionDiff.tsx";

const SHORT_LENGTH = 12;

function fieldWords(field: SigningField): string {
  return `${field.type === "signature" ? "Signature" : "Date"} · page ${String(field.page)}`;
}

/** A first revision has nothing to compare with, so it lists what the document holds. */
function RevisionOutline({
  source,
  pageCount,
}: Readonly<{ source: DocumentSource | null; pageCount: number }>) {
  if (source === null) {
    return <p className={styles.muted}>{`Uploaded PDF · ${String(pageCount)} pages`}</p>;
  }
  return (
    <ol className={styles.outline}>
      {source.sections.map((section, index) => (
        <li key={section.id}>
          {section.heading === "" ? `Section ${String(index + 1)}` : section.heading}
        </li>
      ))}
    </ol>
  );
}

function SignerFields({
  view,
  previous,
}: Readonly<{ view: AgreementView; previous: RevisionView | undefined }>) {
  const draft = view.draft;
  if (draft === null) return null;
  const nameOf = (id: string) => view.recipients.find((item) => item.id === id)?.name ?? "Signer";
  const removed = (previous?.signerIds ?? []).filter((id) => !draft.signerIds.includes(id));
  return (
    <section className={styles.part} aria-labelledby="signer-fields">
      <h2 id="signer-fields">Signature fields</h2>
      {draft.signerIds.length === 0 ? (
        <p className={styles.muted}>No required signers.</p>
      ) : (
        <ul className={styles.signers}>
          {draft.signerIds.map((id) => {
            const fields = draft.signingFields.filter((field) => field.recipientId === id);
            const isNew = previous !== undefined && !previous.signerIds.includes(id);
            return (
              <li key={id} className={styles.signer}>
                <span className={styles.name}>
                  {nameOf(id)}
                  {isNew && <Pill tone="info">New signer</Pill>}
                </span>
                <span className={styles.muted}>
                  {fields.length === 0 ? "No signature field" : fields.map(fieldWords).join(", ")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {removed.length > 0 && (
        <p className={styles.muted}>{`No longer signing: ${removed.map(nameOf).join(", ")}.`}</p>
      )}
    </section>
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
  previous: RevisionView | undefined;
}>) {
  if (previous === undefined) {
    return <RevisionOutline source={draft.source} pageCount={document.pageCount} />;
  }
  if (draft.source === null) {
    return (
      <PdfChange draftPages={document.pageCount} draftSha={document.sha256} previous={previous} />
    );
  }
  return <SectionDiff before={previous.source} after={draft.source} />;
}

/**
 * The last look before a revision is published: what changed since the current revision, who
 * signs where, and the exact PDF that will be published with its SHA. Publishing needs the
 * reviewer's word that they read the PDF, and a different PDF asks for it again.
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
      <div className={styles.left}>
        <section className={styles.part} aria-labelledby="what-changed">
          <h2 id="what-changed">
            {previous === undefined
              ? "What’s in this revision"
              : `What changed since revision ${String(previous.number)}`}
          </h2>
          <WhatChanged draft={draft} document={document} previous={previous} />
        </section>
        <SignerFields view={view} previous={previous} />
      </div>
      <section className={styles.pdf} aria-label="The PDF that will be published">
        <PdfView
          src={fileUrl(view.agreement.id, "draft", { as: "staff" })}
          sha256={document.sha256}
          fields={draft.signingFields}
          viewerRecipientId={null}
          people={view.recipients.map(({ id, name }) => ({ id, name }))}
          lead={<CopyHash sha256={document.sha256} label="SHA-256" />}
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
