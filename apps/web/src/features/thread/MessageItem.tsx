import type { MessageView } from "@dripsign/core/types";
import { Moment } from "@/ui";
import styles from "./MessageItem.module.css";

type MessageItemProps = Readonly<{ message: MessageView; own: boolean }>;

/** One message: who, when (absolute, it is evidence), and the words as plain text. */
export function MessageItem({ message, own }: MessageItemProps) {
  return (
    <article className={styles.message} data-own={own || undefined}>
      <header className={styles.meta}>
        <span className={styles.author}>{message.author.label}</span>
        <Moment value={message.createdAt} format="absolute" />
      </header>
      <p className={styles.body}>{message.body}</p>
    </article>
  );
}
