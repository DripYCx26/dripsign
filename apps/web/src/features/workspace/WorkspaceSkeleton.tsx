import { Skeleton, SkeletonRows } from "@/ui";
import styles from "./WorkspaceSkeleton.module.css";

/** The workspace while its view loads, in the same grid: header row, the rail and the document. */
export function WorkspaceSkeleton() {
  return (
    <div className={styles.skeleton} data-workspace>
      <div className={styles.head}>
        <Skeleton width={30} />
      </div>
      <div className={styles.body}>
        <div className={styles.rail}>
          <SkeletonRows count={4} />
        </div>
        <div className={styles.document}>
          <div className={styles.paper}>
            <Skeleton width={70} />
            <Skeleton width={90} />
            <Skeleton width={90} />
            <Skeleton width={50} />
          </div>
        </div>
      </div>
    </div>
  );
}
