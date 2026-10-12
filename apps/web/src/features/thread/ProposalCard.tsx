"use client";

import type { AgreementView, Capacity, ProposalView } from "@dripsign/core/types";
import { useState } from "react";
import { SectionDiff } from "@/features/document/SectionDiff.tsx";
import { Avatar, Button, ChevronDown, Pill } from "@/ui";
import { Ago } from "./Ago.tsx";
import { startProposal } from "./intent.ts";
import { EarlierVersions } from "./EarlierVersions.tsx";
import { baseSourceOf, changedSection, describeChange, earlierVersions, isOwn } from "./model.ts";
import styles from "./ProposalCard.module.css";

/** What the viewer does to the open proposal: answer the other side's, or withdraw their own. */
export type Decision = "accept" | "reject" | "withdraw";

type ProposalCardProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
  proposal: ProposalView;
  /** Whether the time shows (`threadItems` decides); its exact value is the hover title. */
  timed: boolean;
  /** True while any command of this workspace is in flight. */
  busy: boolean;
  onDecide: (decision: Decision, proposal: ProposalView) => Promise<void>;
}>;

type CardState = "pending" | "accepted" | "declined" | "withdrawn";

function cardState(proposal: ProposalView): CardState {
  // A countered proposal folds into its successor's card, so a superseded card was withdrawn.
  if (proposal.status === "superseded") return "withdrawn";
  if (proposal.status === "accepted") return "accepted";
  if (proposal.status === "rejected") return "declined";
  return "pending";
}

function canAnswer(view: AgreementView): boolean {
  return view.allowedActions.some(
    (action) => action === "accept" || action === "counter" || action === "reject",
  );
}

type MarkProps = Readonly<Omit<ProposalCardProps, "timed" | "busy" | "onDecide">>;

function OpenMark({ view, proposal }: MarkProps) {
  if (canAnswer(view)) return <Pill tone="attention">Your turn</Pill>;
  return <Pill tone="info">{isOwn(proposal.author, view) ? "Waiting" : "Open"}</Pill>;
}

function StateMark(props: MarkProps) {
  const { capacity, proposal } = props;
  switch (cardState(proposal)) {
    case "pending":
      return <OpenMark {...props} />;
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
    case "withdrawn":
      return <Pill tone="info">Withdrawn</Pill>;
  }
}

function Decisions({ view, proposal, busy, onDecide }: Omit<ProposalCardProps, "timed">) {
  const [acting, setActing] = useState<Decision | null>(null);
  const canAccept = view.allowedActions.includes("accept");
  const canCounter = view.allowedActions.includes("counter");
  const canDecline = view.allowedActions.includes("reject");
  const canWithdraw = view.allowedActions.includes("withdraw") && isOwn(proposal.author, view);
  if (!canAnswer(view) && !canWithdraw) return null;

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
      {canWithdraw && (
        <Button
          variant="quiet"
          size="sm"
          loading={acting === "withdraw"}
          disabled={busy && acting !== "withdraw"}
          onClick={() => void decide("withdraw")}
        >
          Withdraw
        </Button>
      )}
    </div>
  );
}

function ProposalBody(props: ProposalCardProps) {
  const { view, proposal, timed } = props;
  const state = cardState(proposal);
  const open = state === "pending";
  const earlier = earlierVersions(view, proposal);
  const before = baseSourceOf(view, proposal);
  const diff = (
    <SectionDiff
      before={before}
      after={proposal.replacementSource}
      namedSectionId={changedSection(before, proposal.replacementSource)?.section.id}
    />
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
            <summary className={styles.toggle}>
              Show change
              <ChevronDown aria-hidden="true" />
            </summary>
            <div className={styles.diff}>{diff}</div>
          </details>
        ))}
      {(timed || earlier.length > 0 || open) && (
        <footer className={styles.foot}>
          <EarlierVersions view={view} versions={earlier} />
          {timed && (
            <p className={styles.time}>
              <Ago value={proposal.createdAt} />
            </p>
          )}
          {open && <Decisions {...props} />}
        </footer>
      )}
    </>
  );
}

/**
 * A proposal in the thread: who proposed what, whose turn it is, the change itself and the
 * actions the policy allows. A decided one folds its diff away; the proposals it countered fold
 * into its footer.
 */
export function ProposalCard(props: ProposalCardProps) {
  const { view, proposal } = props;
  const state = cardState(proposal);
  const open = state === "pending";
  return (
    <article
      className={styles.card}
      data-state={state}
      data-turn={open && canAnswer(view) ? "you" : undefined}
    >
      <ProposalBody {...props} />
    </article>
  );
}
