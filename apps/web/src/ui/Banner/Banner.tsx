import type { ReactNode } from "react";
import { liveRole, type NoticeLive } from "../Notice/Notice.tsx";
import { toneIcon, type ToneName } from "../Tone/Tone.tsx";
import styles from "./Banner.module.css";

type BannerProps = Readonly<{
  tone?: ToneName | undefined;
  live?: NoticeLive | undefined;
  action?: ReactNode;
  children: ReactNode;
}>;

/**
 * A page-wide strip for a state that holds everywhere on the page: a voided agreement, an older
 * revision, development sign-in. Tones come from Tone's one map; the action sits after the words
 * so the words are read first.
 */
export function Banner({ tone = "info", live, action, children }: BannerProps) {
  return (
    <div className={styles.banner} data-tone={tone} role={liveRole(live)}>
      <span className={styles.icon} aria-hidden="true">
        {toneIcon(tone)}
      </span>
      <div className={styles.body}>{children}</div>
      {action}
    </div>
  );
}
