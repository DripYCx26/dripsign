import type { AgreementView, ProposalView } from "@dripsign/core/types";
import { SectionDiff } from "@/features/document/SectionDiff.tsx";
import { ChevronDown } from "@/ui";
import styles from "./EarlierVersions.module.css";
import { baseSourceOf, counteredBy } from "./model.ts";

type EarlierVersionsProps = Readonly<{ view: AgreementView; versions: readonly ProposalView[] }>;

/**
 * What a live proposal replaced: one fold, "N earlier versions", listing who countered each, and
 * each opens to what was proposed then. The newest card is the only one the thread shows.
 */
export function EarlierVersions({ view, versions }: EarlierVersionsProps) {
  if (versions.length === 0) return null;
  return (
    <details className={styles.earlier}>
      <summary className={styles.summary}>
        {`${String(versions.length)} earlier ${versions.length === 1 ? "version" : "versions"}`}
        <ChevronDown aria-hidden="true" />
      </summary>
      <ul className={styles.list}>
        {versions.map((version) => {
          const by = counteredBy(view, version);
          return (
            <li key={version.id}>
              <details className={styles.version}>
                <summary className={styles.summary}>
                  {by === null ? "Countered" : `Countered by ${by.label}`}
                  <span className={styles.show}>
                    Show
                    <ChevronDown aria-hidden="true" />
                  </span>
                </summary>
                <div className={styles.body}>
                  <p className={styles.text}>{`${version.author.label}: ${version.text}`}</p>
                  <SectionDiff
                    before={baseSourceOf(view, version)}
                    after={version.replacementSource}
                  />
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
