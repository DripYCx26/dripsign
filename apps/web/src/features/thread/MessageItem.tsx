import type { MessageView } from "@dripsign/core/types";
import { Moment } from "@/ui";
import styles from "./MessageItem.module.css";

type MessageItemProps = Readonly<{ message: MessageView; own: boolean }>;

/** One chat bubble: the other side's on the left under their name, one's own on the right. */
export function MessageItem({ message, own }: MessageItemProps) {
  return (
    <article className={styles.message} data-own={own || undefined}>
      {!own && <p className={styles.author}>{message.author.label}</p>}
      <p className={styles.bubble}>{message.body}</p>
      <p className={styles.time}>
        <Moment value={message.createdAt} format="absolute" />
      </p>
    </article>
  );
}
