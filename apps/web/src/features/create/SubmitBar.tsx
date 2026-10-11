import Link from "next/link";
import { Button, Notice } from "@/ui";
import styles from "./NewAgreementForm.module.css";
import type { CreatePhase } from "./submit.ts";

const BUTTON_WORDS: Readonly<Record<CreatePhase, string>> = {
  idle: "Create draft",
  creating: "Creating…",
  uploading: "Uploading…",
  preparing: "Preparing signature page…",
};

type SubmitBarProps = Readonly<{
  phase: CreatePhase;
  problem: string | null;
  /** Set once the draft exists; the button then retries the upload alone. */
  createdId: string | null;
}>;

/** The submit button with its working words, a polite status for them, and any failure. */
export function SubmitBar({ phase, problem, createdId }: SubmitBarProps) {
  const busy = phase !== "idle";
  return (
    <>
      {problem !== null && (
        <Notice tone="stop" live="alert">
          <p>{problem}</p>
          {createdId !== null && (
            <Link href={`/staff/agreements/${createdId}`}>Open the draft instead</Link>
          )}
        </Notice>
      )}
      <div className={styles.actions}>
        <Button variant="ink" size="lg" type="submit" loading={busy}>
          {createdId !== null && !busy ? "Retry upload" : BUTTON_WORDS[phase]}
        </Button>
      </div>
      <p className="ds-visually-hidden" role="status">
        {busy ? BUTTON_WORDS[phase] : ""}
      </p>
    </>
  );
}
