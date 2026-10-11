import { SkeletonRows } from "@/ui";
import styles from "./page.module.css";

export default function Loading() {
  return (
    <div className={styles.page}>
      <SkeletonRows count={6} />
    </div>
  );
}
