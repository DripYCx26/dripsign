import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

type EmptyStateProps = Readonly<{
  /** What an empty list or page says; a text node, so a name inside it can never become markup. */
  message: string;
  /** One quieter line under the sentence. */
  detail?: string | undefined;
  /** A glyph from `../icons.tsx`, drawn in a tile above the sentence. */
  icon?: ReactNode;
  /** At most the one action that fills it. */
  action?: ReactNode;
}>;

/** An empty list or page: the sentence and its one action. A failed read is an error, never this. */
export function EmptyState({ message, detail, icon, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      {icon !== undefined && (
        <span className={styles.tile} aria-hidden="true">
          {icon}
        </span>
      )}
      <p className={styles.message}>{message}</p>
      {detail !== undefined && <p className={styles.detail}>{detail}</p>}
      {action}
    </div>
  );
}
