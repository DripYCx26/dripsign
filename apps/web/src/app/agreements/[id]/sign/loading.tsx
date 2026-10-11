import { FocusedFrame } from "@/features/signing/FocusedFrame.tsx";
import { Skeleton } from "@/ui";
import styles from "./loading.module.css";

/** The sign route while the agreement loads: the bar and the column, nothing to act on yet. */
export default function Loading() {
  return (
    <FocusedFrame title={<Skeleton width={30} />}>
      <div className={styles.lines} role="status" aria-busy="true">
        <span className="ds-visually-hidden">Loading</span>
        <Skeleton width={50} />
        <Skeleton width={90} />
        <Skeleton width={70} />
      </div>
    </FocusedFrame>
  );
}
