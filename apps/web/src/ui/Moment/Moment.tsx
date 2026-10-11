"use client";

import { useSyncExternalStore } from "react";
import { formatAbsolute, formatRelative } from "./format.ts";
import styles from "./Moment.module.css";

type MomentProps = Readonly<{
  /** An ISO 8601 instant, as the server sends it. */
  value: string;
  /** absolute: evidence, in the mono face; relative: a list's "5 minutes ago". */
  format: "absolute" | "relative";
}>;

const noopSubscribe = () => () => undefined;

/**
 * A moment as a `<time>`. Absolute is the viewer's own zone with the zone named ("11 Oct 2026
 * 14:05 BST"); the server cannot know it, so the first paint is UTC and the browser replaces it
 * once hydrated. Relative needs no zone, so server and browser agree closely enough to render the
 * same; it reads the clock when it renders and does not tick. An unparseable value is shown as
 * received rather than guessed at.
 */
export function Moment({ value, format }: MomentProps) {
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return <span>{value}</span>;
  if (format === "relative") {
    return (
      <time dateTime={at.toISOString()} suppressHydrationWarning>
        {formatRelative(at, new Date())}
      </time>
    );
  }
  return (
    <time dateTime={at.toISOString()} className={styles.absolute}>
      {formatAbsolute(at, hydrated ? "local" : "utc")}
    </time>
  );
}
