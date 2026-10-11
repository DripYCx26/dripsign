"use client";

import { LIMITS } from "@dripsign/core/schema";
import { useRef, useState } from "react";
import { Dropzone, Notice } from "@/ui";
import { randomId } from "./ids.ts";
import styles from "./PdfReplacer.module.css";
import { uploadPdf } from "./upload.ts";

type Phase = "idle" | "uploading" | "preparing";

const BYTES_PER_MB = 1024 * 1024;

const PHASE_WORDS: Readonly<Record<Exclude<Phase, "idle">, string>> = {
  uploading: "Uploading…",
  preparing: "Preparing signature page…",
};

type PdfReplacerProps = Readonly<{
  agreementId: string;
  /** The agreement version the upload is fenced on. */
  version: number;
  /** Refreshes what the page shows once the server has the file. */
  onUploaded: () => Promise<void>;
}>;

/**
 * "Replace PDF" for a draft that is an uploaded file. One receipt key per chosen file: a retry of
 * the same file after an uncertain failure reuses it; a different file gets a fresh one.
 */
export function PdfReplacer({ agreementId, version, onUploaded }: PdfReplacerProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ file: File; key: string } | null>(null);

  async function replace(file: File) {
    const key = attempt.current?.file === file ? attempt.current.key : `upload-${randomId()}`;
    attempt.current = { file, key };
    setError(null);
    setPhase("uploading");
    const result = await uploadPdf(agreementId, file, key, version);
    if (!result.ok) {
      setError(result.message);
      setPhase("idle");
      return;
    }
    attempt.current = null;
    setPhase("preparing");
    await onUploaded();
    setPhase("idle");
  }

  return (
    <div className={styles.replacer}>
      <p className={styles.title}>Replace PDF</p>
      <Dropzone
        maxMb={LIMITS.pdfBytes / BYTES_PER_MB}
        disabled={phase !== "idle"}
        onFile={(file) => {
          void replace(file);
        }}
      />
      {phase !== "idle" && <p role="status">{PHASE_WORDS[phase]}</p>}
      {error !== null && (
        <Notice tone="stop" live="alert">
          {error}
        </Notice>
      )}
    </div>
  );
}
