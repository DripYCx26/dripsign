"use client";

import type { AgreementView, Capacity, ProposalView } from "@dripsign/core/types";
import { useState } from "react";
import { SectionDiff } from "@/features/document/SectionDiff.tsx";
import { Button, Moment, Pill } from "@/ui";
import { baseSourceOf, counteredBy, describeChange } from "./model.ts";
import styles from "./ProposalCard.module.css";

export type Decision = "accept" | "reject";

type ProposalCardProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
  proposal: ProposalView;
  /** True while any command of this workspace is in flight. */
  busy: boolean;
  onDecide: (decision: Decision, proposal: ProposalView) => Promise<void>;
  onCounter: () => void;
}>;

type CardState = "pending" | "stale" | "accepted" | "declined" | "superseded";

function cardState(view: AgreementView, proposal: ProposalView): CardState {
  if (proposal.status === "superseded") return "superseded";
  if (proposal.status === "accepted") return "accepted";
  if (proposal.status === "rejected") return "declined";
  const current = view.agreement.currentRevisionNumber ?? proposal.baseRevisionNumber;
  return proposal.baseRevisionNumber < current ? "stale" : "pending";
}

function StateMark({
  state,
  proposal,
  capacity,
}: Readonly<{ state: CardState; proposal: ProposalView; capacity: Capacity }>) {
  switch (state) {
    case "pending":
      return <Pill tone="attention">Open</Pill>;
    case "stale":
      return (
        <Pill tone="attention">{`Based on revision ${String(proposal.baseRevisionNumber)}`}</Pill>
      );
    case "declined":
      return <Pill tone="info">Declined</Pill>;
    case "accepted":
      if (proposal.publishedInRevision !== null) {
        return (
          <Pill tone="confirm">{`Published in revision ${String(proposal.publishedInRevision)}`}</Pill>
        );
      }
      // Recipients never learn about private drafts, so their side of "accepted" stops there.
      return <Pill tone="confirm">{capacity === "staff" ? "In draft" : "Accepted"}</Pill>;
    case "superseded":
      return null;
  }
}

function Decisions({ view, capacity, proposal, busy, onDecide, onCounter }: ProposalCardProps) {
  const [acting, setActing] = useState<Decision | null>(null);
  const canAccept = view.allowedActions.includes("accept");
  const canCounter = view.allowedActions.includes("counter");
  const canDecline = view.allowedActions.includes("reject");
  if (!canAccept && !canCounter && !canDecline) return null;

  async function decide(decision: Decision) {
    setActing(decision);
    try {
      await onDecide(decision, proposal);
    } finally {
      setActing(null);
    }
  }

  return (
    <div className={styles.decisions}>
      <div className={styles.buttons}>
        {canAccept && (
          <Button
            variant="ink"
            size="sm"
            loading={acting === "accept"}
            disabled={busy && acting !== "accept"}
            onClick={() => void decide("accept")}
          >
            Accept
          </Button>
        )}
        {canCounter && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={onCounter}>
            Counter
          </Button>
        )}
        {canDecline && (
          <Button
            variant="quiet"
            size="sm"
            loading={acting === "reject"}
            disabled={busy && acting !== "reject"}
            onClick={() => void decide("reject")}
          >
            Decline
          </Button>
        )}
      </div>
      {capacity === "staff" && canAccept && proposal.replacementSource !== null && (
        <p className={styles.note}>
          Accepting updates your private draft. You&rsquo;ll review and publish it.
        </p>
      )}
    </div>
  );
}

function ProposalBody(props: ProposalCardProps) {
  const { view, capacity, proposal } = props;
  const state = cardState(view, proposal);
  const open = state === "pending" || state === "stale";
  const diff = (
    <SectionDiff before={baseSourceOf(view, proposal)} after={proposal.replacementSource} />
  );
  return (
    <>
      <header className={styles.head}>
        <p className={styles.title}>
          {`${proposal.author.label} proposed ${describeChange(view, proposal)}`}
        </p>
        <StateMark state={state} proposal={proposal} capacity={capacity} />
      </header>
      <p className={styles.reason}>{proposal.text}</p>
      {proposal.replacementSource !== null &&
        (open ? (
          diff
        ) : (
          <details className={styles.change}>
            <summary>Show the change</summary>
            {diff}
          </details>
        ))}
      <p className={styles.time}>
        <Moment value={proposal.createdAt} format="absolute" />
      </p>
      {open && <Decisions {...props} />}
    </>
  );
}

/**
 * A proposal in the thread. Open ones carry an attention edge and the actions the policy allows;
 * decided ones fold their diff away; a superseded one is a single line that can be opened.
 */
export function ProposalCard(props: ProposalCardProps) {
  const { view, proposal } = props;
  const state = cardState(view, proposal);
  if (state === "superseded") {
    const by = counteredBy(view, proposal);
    return (
      <details className={styles.superseded}>
        <summary className={styles.summary}>
          <span>{by === null ? "Countered" : `Countered by ${by.label}`}</span>
          <span className={styles.show} aria-hidden="true">
            Show
          </span>
        </summary>
        <div className={styles.card} data-state="superseded">
          <ProposalBody {...props} />
        </div>
      </details>
    );
  }
  return (
    <article className={styles.card} data-state={state}>
      <ProposalBody {...props} />
    </article>
  );
}
