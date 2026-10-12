import { AgreementRow } from "./AgreementRow.tsx";
import styles from "./AgreementList.module.css";
import type { RowGroup } from "./rows.ts";

/**
 * Rows in labelled groups, or one flat list when the group has no heading. Each group is a
 * section named by its heading, so a screen reader can jump between them.
 */
export function AgreementList({ groups }: Readonly<{ groups: readonly RowGroup[] }>) {
  return (
    <div className={styles.list}>
      {groups.map((group) => {
        const headingId = `group-${group.id}`;
        return (
          <section
            key={group.id}
            className={styles.group}
            aria-labelledby={group.heading === null ? undefined : headingId}
          >
            {group.heading !== null && (
              <h2 id={headingId} className={styles.heading}>
                {group.heading}
                <span className={styles.count}>{group.rows.length}</span>
              </h2>
            )}
            <ul className={styles.rows}>
              {group.rows.map((row, index) => (
                <AgreementRow key={row.id} row={row} index={index} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
