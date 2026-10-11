"use client";

import { Button } from "@/ui";
import styles from "./ErrorActions.module.css";

type ErrorActionsProps = Readonly<{
  /** Next's hash of the server-side error, to match against the server log. */
  digest: string | undefined;
  retry: () => void;
}>;

/** What a failed page offers: try again, and the request ID to quote. */
export function ErrorActions({ digest, retry }: ErrorActionsProps) {
  return (
    <div className={styles.actions}>
      <Button variant="ink" onClick={retry}>
        Try again
      </Button>
      {digest !== undefined && <p className={styles.id}>Request ID {digest}</p>}
    </div>
  );
}
