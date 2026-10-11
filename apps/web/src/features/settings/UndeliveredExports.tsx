"use client";

import type { UndeliveredCompletion } from "@dripsign/core/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { settle } from "@/features/shell/settle.ts";
import { recoverCompletionExport } from "@/server/actions/settings.ts";
import { Button, Clock, EmptyState, Moment, Notice, OctagonAlert } from "@/ui";
import styles from "./CompletionExport.module.css";

const RUNNING = "A delivery attempt is running now. Try again in a few minutes.";

type Props = Readonly<{ items: readonly UndeliveredCompletion[]; deliveryEnabled: boolean }>;

/** Executed events the host has not acknowledged; a stopped one can be sent again as frozen. */
export function UndeliveredExports({ items, deliveryEnabled }: Props) {
  const router = useRouter();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function retry(roundId: string) {
    setRetrying(roundId);
    setProblem(null);
    const result = await settle(recoverCompletionExport({ roundId }));
    setRetrying(null);
    if (result.ok) router.refresh();
    else setProblem(result.code === "conflict" ? RUNNING : result.message);
  }

  if (items.length === 0) {
    return <EmptyState message="The host has acknowledged every executed agreement." />;
  }
  return (
    <div className={styles.section}>
      {problem !== null && (
        <Notice tone="stop" live="alert">
          {problem}
        </Notice>
      )}
      <ul className={styles.list} aria-label="Undelivered events">
        {items.map((item) => (
          <li key={item.roundId} className={styles.row}>
            <div className={styles.what}>
              <Link href={`/staff/agreements/${item.agreementId}`} className={styles.name}>
                {item.title}
              </Link>
              <p className={styles.detail}>
                <span className={styles.state}>
                  <span aria-hidden="true">
                    {item.state === "queued" ? <Clock size={14} /> : <OctagonAlert size={14} />}
                  </span>
                  {item.state === "queued" ? "Sending" : "Delivery stopped"}
                </span>
                <span>
                  signed <Moment value={item.completedAt} format="absolute" />
                </span>
              </p>
              <p className={styles.pins}>event {item.eventId}</p>
            </div>
            {item.state === "failed" && deliveryEnabled && (
              <Button
                variant="secondary"
                loading={retrying === item.roundId}
                onClick={() => {
                  void retry(item.roundId);
                }}
              >
                Send again
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
