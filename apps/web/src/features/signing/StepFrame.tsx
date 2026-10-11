"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./StepFrame.module.css";

type StepFrameProps = Readonly<{
  /** The step's one h1, in the display face. */
  title: string;
  /** Move focus to the title once, when the step appears after an action (not on first load). */
  autoFocus: boolean;
  children: ReactNode;
}>;

/** One step of the flow: the title that takes focus on arrival, then the step's content. */
export function StepFrame({ title, autoFocus, children }: StepFrameProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const focusOnMount = useRef(autoFocus);
  useEffect(() => {
    if (focusOnMount.current) heading.current?.focus();
  }, []);
  return (
    <section className={styles.step}>
      <h1 ref={heading} tabIndex={-1} className={styles.title}>
        {title}
      </h1>
      {children}
    </section>
  );
}

/** The step's actions; below 640 px they stick to the bottom of the screen. */
export function StepActions({ children }: Readonly<{ children: ReactNode }>) {
  return <div className={styles.actions}>{children}</div>;
}

/** The step's explanatory line under its title. */
export function StepLede({ children }: Readonly<{ children: ReactNode }>) {
  return <p className={styles.lede}>{children}</p>;
}
