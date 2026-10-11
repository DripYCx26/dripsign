import type { TimelineItem } from "@dripsign/core/types";
import { describeActivity } from "@/features/manage/activity.ts";
import { Moment } from "@/ui";
import styles from "./SystemRow.module.css";

/** A milestone of the agreement as a small centred line in the conversation, evidence beneath. */
export function SystemRow({ item }: Readonly<{ item: TimelineItem }>) {
  const { text, evidence } = describeActivity(item);
  return (
    <div className={styles.row}>
      <p>
        {`${text.replace(/\.$/u, "")} · `}
        <Moment value={item.at} format="absolute" />
      </p>
      {evidence !== undefined && evidence !== "" && <p className={styles.evidence}>{evidence}</p>}
    </div>
  );
}
