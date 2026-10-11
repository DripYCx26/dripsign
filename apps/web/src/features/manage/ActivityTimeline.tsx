import type { AgreementView } from "@dripsign/core/types";
import { EmptyState, Moment } from "@/ui";
import { describeActivity } from "./activity.ts";
import styles from "./ActivityTimeline.module.css";

/**
 * The agreement's story, oldest first, from the database's own timeline (already filtered for the
 * viewer). Times are absolute and mono because this is the record, not a feed.
 */
export function ActivityTimeline({ view }: Readonly<{ view: AgreementView }>) {
  if (view.timeline.length === 0) return <EmptyState message="No activity yet." />;
  const rows = [...view.timeline].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return (
    <ol className={styles.timeline} aria-label="Activity">
      {rows.map((item, index) => {
        const { text, evidence } = describeActivity(item);
        return (
          // The view has no row id; time, kind and position are stable for one snapshot.
          <li key={`${item.at}-${item.kind}-${String(index)}`} className={styles.row}>
            <p className={styles.text}>{text}</p>
            {evidence !== undefined && evidence !== "" && (
              <p className={styles.evidence}>{evidence}</p>
            )}
            <p className={styles.time}>
              <Moment value={item.at} format="absolute" />
            </p>
          </li>
        );
      })}
    </ol>
  );
}
