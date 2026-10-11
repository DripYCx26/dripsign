import type { ReactNode } from "react";
import { toneIcon, type ToneName } from "../Tone/Tone.tsx";
import styles from "./Notice.module.css";

/** `polite` announces when it appears (progress, pauses); `alert` interrupts (a failure). */
export type NoticeLive = "polite" | "alert";

/** The live-region role for a notice's urgency; polite is the status role. */
export function liveRole(live: NoticeLive | undefined): "status" | "alert" | undefined {
  if (live === undefined) return undefined;
  return live === "alert" ? "alert" : "status";
}

type NoticeProps = Readonly<{
  tone?: ToneName | undefined;
  live?: NoticeLive | undefined;
  children: ReactNode;
}>;

/**
 * An inline state box: the tone's icon, then the words and any action stacked beside it. The
 * words always carry the meaning, so the tone is never the only signal.
 */
export function Notice({ tone = "info", live, children }: NoticeProps) {
  return (
    <div className={styles.notice} data-tone={tone} role={liveRole(live)}>
      <span className={styles.icon} aria-hidden="true">
        {toneIcon(tone)}
      </span>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
