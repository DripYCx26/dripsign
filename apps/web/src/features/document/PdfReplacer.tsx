"use client";

import { LIMITS } from "@dripsign/core/schema";
import { useRef, useState } from "react";
import { Dropzone, Notice } from "@/ui";
import { randomId } from "./ids.ts";
import styles from "./PdfReplacer.module.css";
import { uploadPdf } from "./upload.ts";

const BYTES_PER_MB = 1024 * 1024;

type PdfReplacerProps = Readonly<{
  agreementId: string;
  /** The agreement version the upload is fenced on. */
  version: number;
  /** The server has the file: show what it now holds. */
  onUploaded: () => void;
}>;

/**
 * The drop target that replaces an uploaded draft's PDF. One receipt key per chosen file: a retry
 * of the same file after an uncertain failure reuses it; a different file gets a fresh one.
 */
export function PdfReplacer({ agreementId, version, onUploaded }: PdfReplacerProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ file: File; key: string } | null>(null);

  async function replace(file: File) {
    const key = attempt.current?.file === file ? attempt.current.key : `upload-${randomId()}`;
    attempt.current = { file, key };
    setError(null);
    setUploading(true);
    const result = await uploadPdf(agreementId, file, key, version);
    setUploading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    attempt.current = null;
    onUploaded();
  }

  return (
    <div className={styles.replacer}>
      <Dropzone
        maxMb={LIMITS.pdfBytes / BYTES_PER_MB}
        disabled={uploading}
        onFile={(file) => {
          void replace(file);
        }}
      />
      {uploading && <p role="status">Uploading…</p>}
      {error !== null && (
        <Notice tone="stop" live="alert">
          {error}
        </Notice>
      )}
    </div>
  );
}
