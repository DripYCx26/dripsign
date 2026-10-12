import { LoadingFrame } from "@/features/shell/LoadingFrame.tsx";
import { SkeletonRows } from "@/ui";
import styles from "./page.module.css";

export default function Loading() {
  return (
    <LoadingFrame>
      <div className={styles.page}>
        <SkeletonRows count={6} />
      </div>
    </LoadingFrame>
  );
}
