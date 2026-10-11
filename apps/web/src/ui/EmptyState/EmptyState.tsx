import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

type EmptyStateProps = Readonly<{
  /** What an empty list or page says; a text node, so a name inside it can never become markup. */
  message: string;
  /** At most the one action that fills it. */
  action?: ReactNode;
}>;

/** An empty list or page: the sentence and its one action. A failed read is an error, never this. */
export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <p>{message}</p>
      {action}
    </div>
  );
}
