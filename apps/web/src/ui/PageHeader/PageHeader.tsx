import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

type PageHeaderProps = Readonly<{
  /** A short line above the title: the place the page sits in ("Staff workspace"). */
  eyebrow?: string | undefined;
  /** The page's one h1, in the display face. */
  title: string;
  /** Controls at the end of the title line. */
  actions?: ReactNode;
}>;

/** The head of a page: an optional eyebrow, the h1, and the page's actions at the end. */
export function PageHeader({ eyebrow, title, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        {eyebrow !== undefined && <p className={styles.eyebrow}>{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
