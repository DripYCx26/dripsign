import { Skeleton, SkeletonRows } from "@/ui";
import styles from "./WorkspaceSkeleton.module.css";

/** The workspace while its view loads: a title line, the thread rows and the document column. */
export function WorkspaceSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true">
      <div className={styles.head}>
        <Skeleton width={50} />
        <Skeleton width={30} />
      </div>
      <div className={styles.body}>
        <SkeletonRows count={4} />
        <div className={styles.paper}>
          <Skeleton width={70} />
          <Skeleton width={90} />
          <Skeleton width={90} />
          <Skeleton width={50} />
        </div>
      </div>
    </div>
  );
}
