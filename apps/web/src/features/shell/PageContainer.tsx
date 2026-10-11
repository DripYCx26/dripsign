import type { ReactNode } from "react";
import styles from "./PageContainer.module.css";

/** The padded, centred 1280 px column list and admin pages sit in; workspaces do not use it. */
export function PageContainer({ children }: Readonly<{ children: ReactNode }>) {
  return <div className={styles.container}>{children}</div>;
}
