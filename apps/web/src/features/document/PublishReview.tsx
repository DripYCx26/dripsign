import type { SigningField } from "@dripsign/core/schema";
import type { AgreementView, RevisionView } from "@dripsign/core/types";
import Link from "next/link";
import { fileUrl } from "@/features/files";
import { Notice, Pill } from "@/ui";
import { CopyHash } from "./CopyHash.tsx";
import { PdfView } from "./PdfView.tsx";
import styles from "./PublishReview.module.css";
import { PublishAction } from "./PublishAction.tsx";
import { SectionDiff } from "./SectionDiff.tsx";

const SHORT_LENGTH = 12;

function Unavailable({ view, message }: Readonly<{ view: AgreementView; message: string }>) {
  return (
    <Notice tone="attention">
      <p>{message}</p>
      <Link href={`/staff/agreements/${view.agreement.id}`}>Back to the agreement</Link>
    </Notice>
  );
}

function fieldWords(field: SigningField): string {
  return `${field.type === "signature" ? "Signature" : "Date"} · page ${String(field.page)}`;
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
    <section className={styles.card} aria-labelledby="signer-fields">
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
}: Readonly<{ draftPages: number; draftSha: string; previous: RevisionView | undefined }>) {
  if (previous === undefined) return null;
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

/**
 * The last look before a revision is published: what changed since the current revision, who
 * signs where, and the exact PDF that will be published with its SHA. Publishing needs the
 * reviewer's word that they read the PDF.
 */
export function PublishReview({ view }: Readonly<{ view: AgreementView }>) {
  const { draft } = view;
  const document = draft?.document ?? null;
  if (draft === null || document === null || draft.preparation.status !== "ready") {
    const failed = draft?.preparation.status === "failed";
    return (
      <Unavailable
        view={view}
        message={
          failed
            ? "The PDF couldn’t be prepared, so it can’t be published."
            : "The PDF is still being prepared. Come back when it’s ready."
        }
      />
    );
  }
  if (!view.allowedActions.includes("publish")) {
    return <Unavailable view={view} message="There’s nothing to publish right now." />;
  }
  const currentNumber = view.agreement.currentRevisionNumber;
  const previous = view.revisions.find((revision) => revision.number === currentNumber);
  const number = (currentNumber ?? 0) + 1;
  const isFirst = previous === undefined;
  return (
    <div className={styles.review}>
      <div className={styles.left}>
        <section className={styles.card} aria-labelledby="what-changed">
          <h2 id="what-changed">
            {previous === undefined
              ? "What’s in this revision"
              : `What changed since revision ${String(previous.number)}`}
          </h2>
          {previous === undefined && <p>First revision. Everything below is new.</p>}
          {draft.source === null ? (
            <PdfChange
              draftPages={document.pageCount}
              draftSha={document.sha256}
              previous={previous}
            />
          ) : (
            <SectionDiff before={previous?.source ?? null} after={draft.source} />
          )}
        </section>
        <SignerFields view={view} previous={previous} />
      </div>
      <div className={styles.right}>
        <section className={styles.card} aria-labelledby="exact-pdf">
          <h2 id="exact-pdf">The PDF that will be published</h2>
          <CopyHash sha256={document.sha256} label="SHA-256" />
          <PdfView
            src={fileUrl(view.agreement.id, "draft", { as: "staff" })}
            fields={draft.signingFields}
            viewerRecipientId={null}
            people={view.recipients.map(({ id, name }) => ({ id, name }))}
          />
        </section>
        <PublishAction
          view={view}
          reviewedSha256={document.sha256}
          number={number}
          isFirst={isFirst}
        />
      </div>
    </div>
  );
}
