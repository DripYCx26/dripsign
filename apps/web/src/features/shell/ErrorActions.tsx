"use client";

import { Button } from "@/ui";
import styles from "./ErrorActions.module.css";

type ErrorActionsProps = Readonly<{
  /** Next's hash of the server-side error, to match against the server log. */
  digest: string | undefined;
  retry: () => void;
}>;

/** What a failed page offers: try again or go back, and the request ID to quote. */
export function ErrorActions({ digest, retry }: ErrorActionsProps) {
  return (
    <div className={styles.actions}>
      <div className={styles.row}>
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
        {/* A plain anchor: global-error renders where the app router is not running. */}
        <a href="/">Back to agreements</a>
      </div>
      {digest !== undefined && <p className={styles.id}>Request ID {digest}</p>}
    </div>
  );
}
