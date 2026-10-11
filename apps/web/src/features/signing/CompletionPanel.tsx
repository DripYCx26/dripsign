"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgreementView, Capacity, RoundView } from "@dripsign/core/types";
import { fileUrl } from "@/features/files.ts";
import { Banner, Download, Moment } from "@/ui";
import { formatBytes } from "./format.ts";
import styles from "./CompletionPanel.module.css";

const POLL_MS = 5000;
const MAX_POLLS = 24;

type CompletionPanelProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
}>;

/**
 * What the agreement shows once the last signature is in: a strip while the signed files are
 * prepared, then one line confirming it with the audit record. Renders nothing before that.
 */
export function CompletionPanel({ view, capacity }: CompletionPanelProps) {
  if (view.agreement.status === "signed" && view.completedRound !== null) {
    return (
      <div className={styles.strip}>
        <SignedStrip view={view} round={view.completedRound} capacity={capacity} />
      </div>
    );
  }
  if (view.activeRound?.status === "finalizing") {
    return (
      <div className={styles.strip}>
        <FinalizingStrip delayed={view.activeRound.finalizingDelayed} />
      </div>
    );
  }
  return null;
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

/** The one line once everyone has signed; the signed PDF itself is the page's primary action. */
function SignedStrip({
  view,
  round,
  capacity,
}: Readonly<{ view: AgreementView; round: RoundView; capacity: Capacity }>) {
  const audit = view.artifacts.find((a) => a.roundId === round.id && a.kind === "audit_record");
  const signedTimes = round.signers.flatMap((s) =>
    s.signature === null ? [] : [s.signature.signedAt],
  );
  const completedAt = round.endedAt ?? signedTimes.toSorted().at(-1);
  return (
    <Banner
      tone="confirm"
      live="polite"
      action={
        audit !== undefined && (
          <a
            className={styles.file}
            href={fileUrl(view.agreement.id, "audit", { as: capacity })}
            download
          >
            <span
              className={styles.label}
            >{`Audit record · ${formatBytes(audit.byteLength)}`}</span>
            <Download aria-hidden="true" />
          </a>
        )
      }
    >
      {completedAt === undefined ? (
        "Signed by everyone"
      ) : (
        <>
          Signed by everyone · <Moment value={completedAt} format="relative" />
        </>
      )}
    </Banner>
  );
}
