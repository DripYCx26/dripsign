import type { ReactNode } from "react";
import { ButtonLink } from "@/ui";
import styles from "./FocusedFrame.module.css";

type FocusedFrameProps = Readonly<{
  /** The agreement title; a node so the loading state can pass a placeholder. */
  title: ReactNode;
  /** Where Exit goes; absent while the route is still loading. */
  exitHref?: string | undefined;
  children: ReactNode;
}>;

/**
 * The signing route's chrome: a 56 px bar and one 640 px column, with none of the app's
 * navigation, so nothing competes with the document and the signature.
 */
export function FocusedFrame({ title, exitHref, children }: FocusedFrameProps) {
  return (
    <div className={styles.frame}>
      <header className={styles.bar}>
        <p className={styles.title}>Signing · {title}</p>
        {exitHref !== undefined && (
          <ButtonLink variant="quiet" size="sm" href={exitHref}>
            Exit
          </ButtonLink>
        )}
      </header>
      <main className={styles.column}>{children}</main>
    </div>
  );
}
