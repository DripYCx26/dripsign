"use client";

import type { AgreementView } from "@dripsign/core/types";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCommand } from "@/features/command/useCommand";
import { Button, Checkbox, Notice } from "@/ui";
import styles from "./PublishAction.module.css";

type PublishActionProps = Readonly<{
  view: AgreementView;
  /** The draft PDF's SHA-256 shown on the page: exactly what the reviewer looked at. */
  reviewedSha256: string;
  number: number;
  isFirst: boolean;
}>;

/**
 * The review checkbox and the publish button, pinned to the foot of the screen under the long
 * PDF. The command carries the SHA the page showed, so a draft that changed since is refused by
 * the server instead of published unseen.
 */
export function PublishAction({
  view: initial,
  reviewedSha256,
  number,
  isFirst,
}: PublishActionProps) {
  const router = useRouter();
  const { view, run, pending, error, clearError } = useCommand(
    initial.agreement.id,
    "staff",
    initial,
  );
  const [reviewed, setReviewed] = useState(false);

  async function publish() {
    const published = await run(
      { kind: "publish", expectedVersion: view.agreement.version, reviewedSha256 },
      "publish",
    );
    if (published) router.push(`/staff/agreements/${initial.agreement.id}`);
  }

  return (
    <form
      className={styles.action}
      onSubmit={(event) => {
        event.preventDefault();
        if (reviewed) void publish();
      }}
    >
      <div className={styles.row}>
        <Checkbox
          label="I reviewed the full PDF and its signature fields."
          checked={reviewed}
          disabled={pending}
          onChange={setReviewed}
        />
        <Button variant="ink" size="lg" type="submit" loading={pending} disabled={!reviewed}>
          {isFirst ? "Publish and invite recipients" : `Publish revision ${String(number)}`}
        </Button>
      </div>
      {error !== null && (
        <Notice tone="stop" live="alert">
          <p>{error.message}</p>
          {error.code === "conflict" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                clearError();
                setReviewed(false);
                router.refresh();
              }}
            >
              Reload
            </Button>
          )}
        </Notice>
      )}
    </form>
  );
}
