"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./StepFrame.module.css";

type StepFrameProps = Readonly<{
  /** The step's h2 under the frame's h1; it is what takes focus on arrival. */
  title: string;
  /** The title names the step for assistive technology only: the content already says it. */
  hideTitle?: boolean;
  /** Move focus to the title once, when the step appears after an action (not on first load). */
  autoFocus: boolean;
  /** The step needs the full column (the document); the others sit in a narrower one. */
  wide?: boolean;
  /** An outcome's glyph before the title, which then reads at display size: the signed receipt. */
  icon?: ReactNode;
  children: ReactNode;
}>;

/** One step of the flow: the title that takes focus on arrival, then the step's content. */
export function StepFrame({
  title,
  hideTitle = false,
  autoFocus,
  wide = false,
  icon,
  children,
}: StepFrameProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const focusOnMount = useRef(autoFocus);
  useEffect(() => {
    if (focusOnMount.current) heading.current?.focus();
  }, []);
  return (
    <section className={styles.step} data-wide={wide || undefined}>
      <h2
        ref={heading}
        tabIndex={-1}
        className={hideTitle ? "ds-visually-hidden" : styles.title}
        data-outcome={icon !== undefined || undefined}
      >
        {icon !== undefined && (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        )}
        {title}
      </h2>
      {children}
    </section>
  );
}

type StepActionsProps = Readonly<{
  /** What the buttons depend on, at the start of the row: the review checkbox. */
  lead?: ReactNode;
  children: ReactNode;
}>;

/** The step's actions, pinned to the bottom of the screen with their checkbox beside them. */
export function StepActions({ lead, children }: StepActionsProps) {
  return (
    <div className={styles.actions}>
      {lead}
      <div className={styles.buttons}>{children}</div>
    </div>
  );
}
