import type { ReactNode } from "react";
import { BadgeCheck, Ban, FilePen, MessagesSquare, PenLine } from "../icons.tsx";
import type { ToneName } from "../Tone/Tone.tsx";
import styles from "./Pill.module.css";

/** An agreement's lifecycle status; `void` reads "Voided". */
export type AgreementStatus = "draft" | "review" | "signing" | "signed" | "void";

const STATUS: Readonly<Record<AgreementStatus, Readonly<{ word: string; icon: ReactNode }>>> = {
  draft: { word: "Draft", icon: <FilePen /> },
  review: { word: "In review", icon: <MessagesSquare /> },
  signing: { word: "Signing", icon: <PenLine /> },
  signed: { word: "Signed", icon: <BadgeCheck /> },
  void: { word: "Voided", icon: <Ban /> },
};

type PillProps =
  | Readonly<{ status: AgreementStatus; tone?: never; icon?: never; children?: never }>
  | Readonly<{ tone: ToneName; icon?: ReactNode; status?: never; children: string }>;

/**
 * A state as a pill: an agreement status with its word and icon, or a tone with its own word
 * ("Required", "Invited"). Never colour alone: the word is the text, the icon is decoration.
 */
export function Pill(props: PillProps) {
  if (props.status !== undefined) {
    const { word, icon } = STATUS[props.status];
    return (
      <span className={styles.pill} data-status={props.status}>
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
        {word}
      </span>
    );
  }
  return (
    <span className={styles.pill} data-tone={props.tone}>
      {props.icon !== undefined && (
        <span className={styles.icon} aria-hidden="true">
          {props.icon}
        </span>
      )}
      {props.children}
    </span>
  );
}
