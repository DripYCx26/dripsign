import type { DocumentSource } from "@dripsign/core/schema";
import { sectionAnchor } from "./sections.ts";
import { Moment } from "@/ui";
import styles from "./ReadingView.module.css";
import { SuggestEdit } from "./SuggestEdit.tsx";

export interface ReadingSigner {
  readonly id: string;
  readonly name: string;
  readonly signature?: { readonly typedName: string; readonly signedAt: string } | null;
}

type ReadingViewProps = Readonly<{
  source: DocumentSource;
  signers: readonly ReadingSigner[];
  /** Each section offers "Suggest edit" while the viewer may propose a change to the terms. */
  suggestable: boolean;
}>;

/**
 * The agreement's written terms on a white sheet, with a signature block naming who signs. It is
 * a reading aid: the PDF, not this view, is the document that is signed.
 */
export function ReadingView({ source, signers, suggestable }: ReadingViewProps) {
  return (
    <article className={styles.sheet} data-paper aria-labelledby="reading-title">
      <h2 id="reading-title" className={styles.title}>
        {source.title}
      </h2>
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
          <h3 id="reading-signatures" className={styles.heading}>
            Signatures
          </h3>
          <ul className={styles.signers}>
            {signers.map((signer) => (
              <li key={signer.id} className={styles.signer}>
                {signer.signature ? (
                  <>
                    <span className={styles.ink}>{signer.signature.typedName}</span>
                    <span className={styles.signed}>
                      Signed <Moment value={signer.signature.signedAt} format="absolute" />
                    </span>
                  </>
                ) : (
                  <>
                    <span className={styles.line} aria-hidden="true" />
                    <span>{signer.name}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
