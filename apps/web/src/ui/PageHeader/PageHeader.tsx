import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

type PageHeaderProps = Readonly<{
  /** The page's one h1, in the display face. */
  title: string;
  /** Controls at the end of the title line. */
  actions?: ReactNode;
}>;

/** The head of a page: the h1 and the page's actions at the end. */
export function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <h1>{title}</h1>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
