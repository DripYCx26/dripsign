import type { ReactNode } from "react";
import { Mark } from "@/ui";
import styles from "./EntryFrame.module.css";

type EntryFrameProps = Readonly<{
  /** The page's one h1, in the display face. */
  title: string;
  /** One sentence under the title: what happened, or what this page needs. */
  lead?: string | undefined;
  /** `entry` is the 400 px column of sign-in; `wide` fits a row of cards. */
  width?: "entry" | "wide" | undefined;
  children: ReactNode;
}>;

/**
 * The frame for pages that stand alone, without the signed-in bar: sign-in, the development
 * picker, not-found and failures. A plain anchor home, so it also works where the app router is
 * not running (global-error).
 */
export function EntryFrame({ title, lead, width = "entry", children }: EntryFrameProps) {
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <a href="/" className={styles.brand}>
          <Mark />
        </a>
      </header>
      <main id="main" className={styles.main} data-width={width}>
        <div className={styles.intro}>
          <h1 className={styles.title}>{title}</h1>
          {lead !== undefined && <p className={styles.lead}>{lead}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}
