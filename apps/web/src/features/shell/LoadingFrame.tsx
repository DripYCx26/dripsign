import type { ReactNode } from "react";
import { Mark, TopBar } from "@/ui";
import styles from "./AppShell.module.css";

/**
 * What a staff page shows while it loads: the bar's brand where the real bar will draw, so the
 * page does not jump. The session is not read here; the page brings the nav and account.
 */
export function LoadingFrame({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className={styles.shell}>
      <TopBar brand={<Mark />} />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
