import type { ReactNode } from "react";
import { BackButton } from "@/features/workspace/BackButton.tsx";
import { Mark } from "@/ui";
import styles from "./FocusedFrame.module.css";

type FocusedFrameProps = Readonly<{
  /** The agreement title; a node so the loading state can pass a placeholder. */
  title: ReactNode;
  /** Where the back button goes; absent while the route is still loading. */
  exitHref?: string | undefined;
  children: ReactNode;
}>;

/**
 * The signing route's chrome: a 56 px bar (the mark, back, and the title as the page's h1, as in
 * the workspace bar) and one column as wide as the publish page, with none of the app's
 * navigation, so nothing competes with the document and the signature.
 */
export function FocusedFrame({ title, exitHref, children }: FocusedFrameProps) {
  return (
    <div className={styles.frame}>
      <header className={styles.bar}>
        <Mark compact />
        {exitHref !== undefined && <BackButton label="Back to agreement" href={exitHref} />}
        <h1 className={styles.title}>{title}</h1>
      </header>
      <main className={styles.column}>{children}</main>
    </div>
  );
}
