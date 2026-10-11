"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, IconButton } from "@/ui";
import styles from "./CopyHash.module.css";

const NOTICE_MS = 2500;
const SHORT_LENGTH = 12;

type Outcome = "idle" | "copied" | "failed";

const ANNOUNCE: Readonly<Record<Outcome, string>> = {
  idle: "",
  copied: "Copied.",
  failed: "Couldn’t copy.",
};

/** The first 12 characters of a SHA-256 in mono, and a button that copies all 64. */
export function CopyHash({ sha256, label }: Readonly<{ sha256: string; label: string }>) {
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(sha256);
      setOutcome("copied");
    } catch {
      setOutcome("failed");
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setOutcome("idle");
    }, NOTICE_MS);
  }

  return (
    <div className={styles.hash}>
      <span className={styles.label}>{label}</span>
      <code className={styles.value} title={sha256}>
        {sha256.slice(0, SHORT_LENGTH)}
      </code>
      <IconButton
        label="Copy full SHA-256"
        icon={<Copy aria-hidden="true" />}
        size="sm"
        onClick={() => {
          void copy();
        }}
      />
      <span className="ds-visually-hidden" role="status">
        {ANNOUNCE[outcome]}
      </span>
    </div>
  );
}
