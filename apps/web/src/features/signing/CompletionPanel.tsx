"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgreementView, ArtifactKind, Capacity, RoundView } from "@dripsign/core/types";
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
 * prepared, then the confirmation with the files and who signed when. Renders nothing before
 * that.
 */
export function CompletionPanel({ view, capacity }: CompletionPanelProps) {
  if (view.agreement.status === "signed" && view.completedRound !== null) {
    return <SignedPanel view={view} round={view.completedRound} capacity={capacity} />;
  }
  if (view.activeRound?.status === "finalizing") {
    return <FinalizingStrip delayed={view.activeRound.finalizingDelayed} />;
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
    <div className={styles.panel}>
      <Banner tone={slow ? "attention" : "info"} live="polite">
        {slow
          ? "Taking longer than usual. Check back shortly."
          : "Preparing the signed PDF and audit record…"}
      </Banner>
    </div>
  );
}

const FILES = {
  signed_document: { label: "Signed PDF", file: "signed" },
  audit_record: { label: "Audit record", file: "audit" },
} as const satisfies Record<ArtifactKind, unknown>;

function FileLink({
  view,
  round,
  capacity,
  kind,
}: Readonly<{ view: AgreementView; round: RoundView; capacity: Capacity; kind: ArtifactKind }>) {
  const artifact = view.artifacts.find((a) => a.roundId === round.id && a.kind === kind);
  if (artifact === undefined) return null;
  const { label, file } = FILES[kind];
  return (
    <a className={styles.file} href={fileUrl(view.agreement.id, file, { as: capacity })} download>
      {`${label} · ${formatBytes(artifact.byteLength)}`}
      <Download aria-hidden="true" />
    </a>
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
    <section className={styles.panel} aria-label="Signatures">
      <Banner
        tone="confirm"
        live="polite"
        action={
          <span className={styles.files}>
            <FileLink view={view} round={round} capacity={capacity} kind="signed_document" />
            <FileLink view={view} round={round} capacity={capacity} kind="audit_record" />
          </span>
        }
      >
        {completedAt === undefined ? (
          "Signed by everyone"
        ) : (
          <>
            Signed by everyone on <Moment value={completedAt} format="absolute" />
          </>
        )}
      </Banner>
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
