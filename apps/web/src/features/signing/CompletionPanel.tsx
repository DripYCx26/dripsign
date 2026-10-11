"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgreementView, ArtifactKind, Capacity, RoundView } from "@dripsign/core/types";
import { fileUrl } from "@/features/files.ts";
import { Download, FileText, Moment, Notice, ShieldCheck } from "@/ui";
import { formatBytes, shortHash } from "./format.ts";
import styles from "./CompletionPanel.module.css";

const POLL_MS = 5000;
const MAX_POLLS = 24;

type CompletionPanelProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
}>;

/**
 * What the agreement shows once the last signature is in: a progress notice while the signed
 * files are prepared, then the confirmation, the two downloads and who signed when. Renders
 * nothing before that.
 */
export function CompletionPanel({ view, capacity }: CompletionPanelProps) {
  if (view.agreement.status === "signed" && view.completedRound !== null) {
    return <SignedPanel view={view} round={view.completedRound} capacity={capacity} />;
  }
  if (view.activeRound?.status === "finalizing") {
    return <FinalizingPanel delayed={view.activeRound.finalizingDelayed} />;
  }
  return null;
}

/** Polls the server for the archived files, every 5 s for two minutes, then gives up politely. */
function FinalizingPanel({ delayed }: Readonly<{ delayed: boolean }>) {
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

  return (
    <Notice tone={delayed || exhausted ? "attention" : "info"} live="polite">
      <span>
        All signatures are in. Preparing the signed PDF and audit record…
        {delayed && " (delayed)"}
      </span>
      {exhausted && <span>This is taking longer than usual. Check back shortly.</span>}
    </Notice>
  );
}

function SignedPanel({
  view,
  round,
  capacity,
}: Readonly<{ view: AgreementView; round: RoundView; capacity: Capacity }>) {
  const signedTimes = round.signers.flatMap((s) =>
    s.signature === null ? [] : [s.signature.signedAt],
  );
  const completedAt = round.endedAt ?? signedTimes.toSorted().at(-1);
  return (
    <section className={styles.panel} aria-labelledby="completion-title">
      <Notice tone="confirm" live="polite">
        <strong id="completion-title">
          {completedAt === undefined ? (
            "Signed by everyone"
          ) : (
            <>
              Signed by everyone on <Moment value={completedAt} format="absolute" />
            </>
          )}
        </strong>
      </Notice>
      <ul className={styles.cards}>
        <DownloadCard view={view} round={round} capacity={capacity} kind="signed_document" />
        <DownloadCard view={view} round={round} capacity={capacity} kind="audit_record" />
      </ul>
      <h2 className={styles.heading}>Signers</h2>
      <ul className={styles.signers}>
        {round.signers.map((signer) => (
          <li key={signer.recipientId} className={styles.signer}>
            <span>{signer.name}</span>
            {signer.signature !== null && (
              <Moment value={signer.signature.signedAt} format="absolute" />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const CARD = {
  signed_document: { label: "Signed PDF", file: "signed", Icon: FileText },
  audit_record: { label: "Audit record", file: "audit", Icon: ShieldCheck },
} as const satisfies Record<ArtifactKind, unknown>;

function DownloadCard({
  view,
  round,
  capacity,
  kind,
}: Readonly<{ view: AgreementView; round: RoundView; capacity: Capacity; kind: ArtifactKind }>) {
  const artifact = view.artifacts.find((a) => a.roundId === round.id && a.kind === kind);
  if (artifact === undefined) return null;
  const { label, file, Icon } = CARD[kind];
  return (
    <li>
      <a className={styles.card} href={fileUrl(view.agreement.id, file, { as: capacity })} download>
        <span className={styles.icon} aria-hidden="true">
          <Icon />
        </span>
        <span className={styles.text}>
          <span className={styles.label}>{label}</span>
          <span className={styles.meta}>
            {formatBytes(artifact.byteLength)} ·{" "}
            <span className={styles.hash}>{shortHash(artifact.sha256)}</span>
          </span>
        </span>
        <Download aria-hidden="true" />
      </a>
    </li>
  );
}
