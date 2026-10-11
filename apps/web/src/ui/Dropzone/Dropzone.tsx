"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { Button } from "../Button/Button.tsx";
import styles from "./Dropzone.module.css";

const PDF = "application/pdf";
const BYTES_PER_MB = 1024 * 1024;

type DropzoneProps = Readonly<{
  /** The largest file accepted, in megabytes; the server holds the same bound. */
  maxMb: number;
  /** Called with the one valid file, from a drop or the file picker. */
  onFile: (file: File) => void;
  disabled?: boolean | undefined;
}>;

/** The refusal for a file, or null when it is a PDF within the bound. */
function refusal(file: File, maxMb: number): string | null {
  if (file.type !== PDF) return "Only PDF files are accepted.";
  if (file.size > maxMb * BYTES_PER_MB) return `Choose a PDF under ${String(maxMb)} MB`;
  return null;
}

/**
 * Where a PDF goes: a dashed area that takes a drop and shows it is a target while a file is over
 * it, with a button that opens the file picker for everyone who cannot or will not drag. The
 * type and size are checked here for a fast answer; the server checks them again.
 */
export function Dropzone({ maxMb, onFile, disabled = false }: DropzoneProps) {
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const errorId = useId();

  function take(file: File | undefined) {
    if (file === undefined) return;
    const refused = refusal(file, maxMb);
    setError(refused);
    if (refused === null) onFile(file);
  }

  function leave(event: DragEvent<HTMLDivElement>) {
    // Moving over a child fires leave on the zone; only leaving the zone itself ends the state.
    if (!(
      event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
    )) {
      setOver(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div
        className={styles.zone}
        data-over={over || undefined}
        data-disabled={disabled || undefined}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDragLeave={leave}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (!disabled) take(event.dataTransfer.files[0]);
        }}
      >
        <p>
          Drop a PDF here or{" "}
          <Button
            variant="link"
            disabled={disabled}
            onClick={() => {
              picker.current?.click();
            }}
          >
            choose a file
          </Button>
        </p>
        <p className={styles.limit}>{`PDF, up to ${String(maxMb)} MB.`}</p>
        <input
          ref={picker}
          className="ds-visually-hidden"
          type="file"
          accept={`${PDF},.pdf`}
          tabIndex={-1}
          aria-hidden="true"
          aria-describedby={error === null ? undefined : errorId}
          disabled={disabled}
          onChange={(event) => {
            take(event.target.files?.[0]);
            // The same file chosen again after a refusal must fire another change.
            event.target.value = "";
          }}
        />
      </div>
      {error !== null && (
        <p id={errorId} className={styles.error} role="alert" data-tone="stop">
          {error}
        </p>
      )}
    </div>
  );
}
