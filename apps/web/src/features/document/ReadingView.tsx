import type { DocumentSource } from "@dripsign/core/schema";
import { sectionAnchor } from "./sections.ts";
import styles from "./ReadingView.module.css";

export interface ReadingSigner {
  readonly id: string;
  readonly name: string;
}

/**
 * The agreement's written terms on a white sheet, with a signature block naming who signs. It is
 * a reading aid: the PDF, not this view, is the document that is signed.
 */
export function ReadingView({
  source,
  signers,
}: Readonly<{ source: DocumentSource; signers: readonly ReadingSigner[] }>) {
  return (
    <div className={styles.wrap}>
      <p className={styles.note}>Reading view. The PDF is the document you sign.</p>
      <article className={styles.sheet} data-paper aria-labelledby="reading-title">
        <h2 id="reading-title" className={styles.title}>
          {source.title}
        </h2>
        {source.sections.map((section) => (
          <section key={section.id} id={sectionAnchor(section.id)} className={styles.section}>
            {section.heading !== "" && <h3 className={styles.heading}>{section.heading}</h3>}
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
                  <span className={styles.line} aria-hidden="true" />
                  <span>{signer.name}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}
