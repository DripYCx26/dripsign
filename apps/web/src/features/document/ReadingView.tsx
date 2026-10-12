import type { DocumentSource } from "@dripsign/core/schema";
import type { RoundSignerView } from "@dripsign/core/types";
import { BadgeCheck, Moment } from "@/ui";
import styles from "./ReadingView.module.css";
import { sectionAnchor } from "./sections.ts";
import { SuggestEdit } from "./SuggestEdit.tsx";

export interface ReadingSigner {
  readonly id: string;
  readonly name: string;
  readonly signature?: RoundSignerView["signature"];
}

/** What the title block says of the document on show; null dates are not printed. */
export interface ReadingMeta {
  readonly org: string;
  /** Null for the private draft. */
  readonly revision: number | null;
  readonly publishedAt: string | null;
  readonly signedAt: string | null;
  readonly voided: boolean;
}

type ReadingViewProps = Readonly<{
  source: DocumentSource;
  meta: ReadingMeta;
  signers: readonly ReadingSigner[];
  /** Each section offers "Suggest edit" while the viewer may propose a change to the terms. */
  suggestable: boolean;
}>;

/** The caps line under the title: state, revision, dates, and the parties by name, never address. */
function MetaLine({
  meta,
  signers,
}: Readonly<{ meta: ReadingMeta; signers: readonly ReadingSigner[] }>) {
  const names = signers.map((signer) => signer.name).join(", ");
  return (
    <p className={styles.meta}>
      {meta.revision === null && <span className={styles.tag}>Draft</span>}
      {meta.voided && <span className={styles.tag}>Void</span>}
      {meta.revision !== null && <span>{`Revision ${String(meta.revision)}`}</span>}
      {meta.publishedAt !== null && (
        <span>
          Published <Moment value={meta.publishedAt} format="day" />
        </span>
      )}
      {meta.signedAt !== null && (
        <span>
          Signed <Moment value={meta.signedAt} format="day" />
        </span>
      )}
      <span>{names === "" ? meta.org : `${meta.org} ↔ ${names}`}</span>
    </p>
  );
}

function Signer({ signer }: Readonly<{ signer: ReadingSigner }>) {
  const { signature } = signer;
  if (!signature) {
    return (
      <li className={styles.signer}>
        <span className={styles.rule} aria-hidden="true" />
        <span className={styles.pending}>{signer.name}</span>
      </li>
    );
  }
  return (
    <li className={styles.signer}>
      <span className={styles.ink} data-face={signature.face}>
        {signature.typedName}
      </span>
      <span className={styles.evidence}>
        <Moment value={signature.signedAt} format="absolute" />
        <span className={styles.verified}>
          <BadgeCheck aria-hidden="true" />
          Email verified
        </span>
      </span>
    </li>
  );
}

/**
 * The agreement's written terms as a typeset sheet: a title block, numbered sections and a
 * signature block naming who signs. It is a reading aid: the PDF, not this view, is the document
 * that is signed. A signature is drawn in the face the signed PDF used.
 */
export function ReadingView({ source, meta, signers, suggestable }: ReadingViewProps) {
  return (
    <article
      className={styles.sheet}
      data-void={meta.voided || undefined}
      aria-labelledby="reading-title"
    >
      <header className={styles.titleBlock}>
        <h2 id="reading-title" className={styles.title}>
          {source.title}
        </h2>
        <MetaLine meta={meta} signers={signers} />
      </header>
      {source.sections.map((section) => (
        <section
          key={section.id}
          id={sectionAnchor(section.id)}
          className={styles.section}
          data-suggestable={suggestable || undefined}
        >
          {section.heading !== "" && <h3 className={styles.heading}>{section.heading}</h3>}
          {suggestable && (
            <div className={styles.suggest}>
              <SuggestEdit sectionId={section.id} heading={section.heading} />
            </div>
          )}
          {section.paragraphs.map((paragraph, index) => (
            // Paragraphs have no ids; their order is the document.
            <p key={index} className={styles.paragraph}>
              {paragraph}
            </p>
          ))}
        </section>
      ))}
      {signers.length > 0 && (
        <section className={styles.signatures} aria-labelledby="reading-signatures">
          <h3 id="reading-signatures" className={styles.signaturesHeading}>
            Signatures
          </h3>
          <ul className={styles.signers}>
            {signers.map((signer) => (
              <Signer key={signer.id} signer={signer} />
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
