import { Mark, Skeleton, SkeletonRows } from "@/ui";
import styles from "./WorkspaceSkeleton.module.css";

/** The workspace while its view loads, in the same grid: the bar, the rail and a sheet on the desk. */
export function WorkspaceSkeleton() {
  return (
    <div className={styles.skeleton} data-workspace>
      <div className={styles.bar}>
        <Mark compact />
        <Skeleton width={30} />
      </div>
      <div className={styles.body}>
        <div className={styles.rail}>
          <SkeletonRows count={4} />
        </div>
        <div className={styles.desk}>
          <div className={styles.sheet}>
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
