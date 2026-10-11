"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgreementView } from "@dripsign/core/types";
import { Banner } from "@/ui";
import styles from "./CompletionPanel.module.css";

const POLL_MS = 5000;
const MAX_POLLS = 24;

/**
 * Feedback while the last signature's files are prepared. Once they exist the agreement's primary
 * action is the signed PDF and the audit record sits in the workspace menu, so nothing renders.
 */
export function CompletionPanel({ view }: Readonly<{ view: AgreementView }>) {
  if (view.activeRound?.status !== "finalizing") return null;
  return (
    <div className={styles.strip}>
      <FinalizingStrip delayed={view.activeRound.finalizingDelayed} />
    </div>
  );
}

/** Polls the server for the archived files, every 5 s for two minutes, then gives up politely. */
function FinalizingStrip({ delayed }: Readonly<{ delayed: boolean }>) {
  const router = useRouter();
  const [polls, setPolls] = useState(0);
  const exhausted = polls >= MAX_POLLS;

  useEffect(() => {
    if (exhausted) return undefined;
    const timer = setTimeout(() => {
      router.refresh();
      setPolls((count) => count + 1);
    }, POLL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [exhausted, polls, router]);

  const slow = delayed || exhausted;
  return (
    <Banner tone={slow ? "attention" : "info"} live="polite">
      {slow
        ? "Taking longer than usual. Check back shortly."
        : "Preparing the signed PDF and audit record…"}
    </Banner>
  );
}
