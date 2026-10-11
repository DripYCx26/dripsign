"use client";

import type { AgreementView, Capacity, ProposalView } from "@dripsign/core/types";
import { useState } from "react";
import { SectionDiff } from "@/features/document/SectionDiff.tsx";
import { Avatar, Button, ChevronRight, Pill } from "@/ui";
import { Ago } from "./Ago.tsx";
import { startProposal } from "./intent.ts";
import { baseSourceOf, counteredBy, describeChange, isOwn } from "./model.ts";
import styles from "./ProposalCard.module.css";

export type Decision = "accept" | "reject";

type ProposalCardProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
  proposal: ProposalView;
  /** True while any command of this workspace is in flight. */
  busy: boolean;
  onDecide: (decision: Decision, proposal: ProposalView) => Promise<void>;
}>;

type CardState = "pending" | "stale" | "accepted" | "declined" | "superseded";

function cardState(view: AgreementView, proposal: ProposalView): CardState {
  if (proposal.status === "superseded") return "superseded";
  if (proposal.status === "accepted") return "accepted";
  if (proposal.status === "rejected") return "declined";
  const current = view.agreement.currentRevisionNumber ?? proposal.baseRevisionNumber;
  return proposal.baseRevisionNumber < current ? "stale" : "pending";
}

function canAnswer(view: AgreementView): boolean {
  return view.allowedActions.some(
    (action) => action === "accept" || action === "counter" || action === "reject",
  );
}

function OpenMark({ view, proposal }: Readonly<Omit<ProposalCardProps, "busy" | "onDecide">>) {
  if (canAnswer(view)) return <Pill tone="attention">Your turn</Pill>;
  return <Pill tone="info">{isOwn(proposal.author, view) ? "Waiting" : "Open"}</Pill>;
}

function StateMark(props: Readonly<Omit<ProposalCardProps, "busy" | "onDecide">>) {
  const { view, capacity, proposal } = props;
  switch (cardState(view, proposal)) {
    case "pending":
      return <OpenMark {...props} />;
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

function Decisions({ view, proposal, busy, onDecide }: ProposalCardProps) {
  const [acting, setActing] = useState<Decision | null>(null);
  const canAccept = view.allowedActions.includes("accept");
  const canCounter = view.allowedActions.includes("counter");
  const canDecline = view.allowedActions.includes("reject");
  if (!canAnswer(view)) return null;

  async function decide(decision: Decision) {
    setActing(decision);
    try {
      await onDecide(decision, proposal);
    } finally {
      setActing(null);
    }
  }

  return (
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
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => {
            startProposal({ counterOf: proposal.id });
          }}
        >
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
  );
}

function ProposalBody(props: ProposalCardProps) {
  const { view, proposal } = props;
  const state = cardState(view, proposal);
  const open = state === "pending" || state === "stale";
  const diff = (
    <SectionDiff before={baseSourceOf(view, proposal)} after={proposal.replacementSource} />
  );
  return (
    <>
      <header className={styles.head}>
        <Avatar name={proposal.author.label} />
        <p className={styles.title}>
          {`${proposal.author.label} proposed ${describeChange(view, proposal)}`}
        </p>
        <StateMark {...props} />
      </header>
      <p className={styles.reason}>{proposal.text}</p>
      {proposal.replacementSource !== null &&
        (open ? (
          <div className={styles.diff}>{diff}</div>
        ) : (
          <details className={styles.change}>
            <summary>Show change</summary>
            <div className={styles.diff}>{diff}</div>
          </details>
        ))}
      <footer className={styles.foot}>
        <p className={styles.time}>
          <Ago value={proposal.createdAt} />
        </p>
        {open && <Decisions {...props} />}
      </footer>
    </>
  );
}

/**
 * A proposal in the thread: who proposed what, whose turn it is, the change itself and the
 * actions the policy allows. A decided one folds its diff away; a superseded one is one line.
 */
export function ProposalCard(props: ProposalCardProps) {
  const { view, proposal } = props;
  const state = cardState(view, proposal);
  if (state === "superseded") {
    const by = counteredBy(view, proposal);
    return (
      <details className={styles.superseded}>
        <summary className={styles.summary}>
          <span aria-hidden="true">↳</span>
          <span>{by === null ? "Countered" : `Countered by ${by.label}`}</span>
          <span className={styles.show} aria-hidden="true">
            Show
            <ChevronRight />
          </span>
        </summary>
        <article className={styles.card} data-state="superseded">
          <ProposalBody {...props} />
        </article>
      </details>
    );
  }
  return (
    <article className={styles.card} data-state={state}>
      <ProposalBody {...props} />
    </article>
  );
}
