import { Button, Notice } from "@/ui";
import styles from "./NewAgreementForm.module.css";

type SubmitBarProps = Readonly<{
  busy: boolean;
  problem: string | null;
}>;

/** The submit button with its working words, a polite status for them, and any failure. */
export function SubmitBar({ busy, problem }: SubmitBarProps) {
  return (
    <>
      {problem !== null && (
        <Notice tone="stop" live="alert">
          <p>{problem}</p>
        </Notice>
      )}
      <div className={styles.actions}>
        <Button variant="ink" size="lg" type="submit" loading={busy}>
          {busy ? "Creating…" : "Create draft"}
        </Button>
      </div>
      <p className="ds-visually-hidden" role="status">
        {busy ? "Creating…" : ""}
      </p>
    </>
  );
}
