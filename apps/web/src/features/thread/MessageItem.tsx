import type { MessageView } from "@dripsign/core/types";
import { Ago } from "./Ago.tsx";
import styles from "./MessageItem.module.css";

type MessageItemProps = Readonly<{
  message: MessageView;
  own: boolean;
  /** Whether the time shows (`threadItems` decides); its exact value is the hover title. */
  timed: boolean;
}>;

/** One chat bubble: the other side's on the left under their name, one's own on the right. */
export function MessageItem({ message, own, timed }: MessageItemProps) {
  return (
    <article className={styles.message} data-own={own || undefined}>
      {!own && <p className={styles.author}>{message.author.label}</p>}
      <p className={styles.bubble}>{message.body}</p>
      {timed && (
        <p className={styles.time}>
          <Ago value={message.createdAt} />
        </p>
      )}
    </article>
  );
}
