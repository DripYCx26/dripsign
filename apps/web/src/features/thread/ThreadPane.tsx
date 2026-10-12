"use client";

import type { AgreementView, Capacity, ProposalView } from "@dripsign/core/types";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { Composer, type Sent } from "./Composer.tsx";
import { cancelProposal } from "./intent.ts";
import { MessageItem } from "./MessageItem.tsx";
import { isOwn, threadItems, turnSentence, type ThreadItem } from "./model.ts";
import { ProposalCard, type Decision } from "./ProposalCard.tsx";
import { SystemRow } from "./SystemRow.tsx";
import styles from "./ThreadPane.module.css";

const ANNOUNCEMENT: Readonly<Record<Sent, string>> = {
  message: "Message sent.",
  proposal: "Proposal sent.",
};
const ANNOUNCEMENT_MS = 4000;

type ThreadPaneProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
  run: RunCommand;
  busy: boolean;
}>;

/** What a send says to a screen reader, for a few seconds. Focus stays in the composer. */
function useSentAnnouncement() {
  const timer = useRef<number | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  const announce = useCallback((sent: Sent) => {
    setAnnouncement(ANNOUNCEMENT[sent]);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setAnnouncement("");
    }, ANNOUNCEMENT_MS);
  }, []);

  return { announcement, announce };
}

/**
 * Opens the thread at its newest end, where the composer is. An item taller than the list (a long
 * proposal) opens at its own top, so its title is never scrolled out of sight. Keyed on the newest
 * item, not the count: a counterproposal replaces the card it supersedes without adding a row.
 */
function useOpenAtNewest(list: RefObject<HTMLOListElement | null>, newestKey: string | undefined) {
  useEffect(() => {
    const element = list.current;
    const newest = element?.lastElementChild;
    if (element === null || newest == null) return;
    const newestTop = newest.getBoundingClientRect().top - element.getBoundingClientRect().top;
    const end = element.scrollHeight - element.clientHeight;
    element.scrollTo({ top: Math.min(end, element.scrollTop + newestTop) });
  }, [newestKey, list]);
}

type ThreadRowProps = Readonly<{
  item: ThreadItem;
  view: AgreementView;
  capacity: Capacity;
  busy: boolean;
  onDecide: (decision: Decision, proposal: ProposalView) => Promise<void>;
}>;

function ThreadRow({ item, view, capacity, busy, onDecide }: ThreadRowProps) {
  switch (item.kind) {
    case "message":
      return (
        <MessageItem
          message={item.message}
          own={isOwn(item.message.author, view)}
          timed={item.timed}
        />
      );
    case "activity":
      return <SystemRow at={item.at} lines={item.lines} />;
    case "proposal":
      return (
        <ProposalCard
          view={view}
          capacity={capacity}
          proposal={item.proposal}
          timed={item.timed}
          busy={busy}
          onDecide={onDecide}
        />
      );
  }
}

/**
 * The chat rail: the conversation oldest first as an ordered list (messages as bubbles, proposals
 * as cards, milestones as small system rows) with the composer, when there is one, pinned under
 * it; a thread with only milestones is just the list. Staff and
 * recipients see the same list; the view already filtered what each may see. Whose turn it is
 * is announced, not displayed: the cards and the primary action already say it.
 */
export function ThreadPane({ view, capacity, run, busy }: ThreadPaneProps) {
  const items = threadItems(view);
  const list = useRef<HTMLOListElement>(null);
  const { announcement, announce } = useSentAnnouncement();

  useOpenAtNewest(list, items.at(-1)?.key);
  // A proposal in progress belongs to this agreement's thread; leaving it drops the intent.
  useEffect(
    () => () => {
      cancelProposal();
    },
    [view.agreement.id],
  );

  async function decide(decision: Decision, proposal: ProposalView) {
    await run(
      { kind: decision, expectedVersion: view.agreement.version, proposalId: proposal.id },
      `${decision}:${proposal.id}`,
    );
  }

  return (
    <div className={styles.pane}>
      {items.length > 0 && (
        <ol className={styles.list} ref={list} aria-label="Thread">
          {items.map((item) => (
            <li key={item.key} className={styles.item} tabIndex={-1}>
              <ThreadRow
                item={item}
                view={view}
                capacity={capacity}
                busy={busy}
                onDecide={decide}
              />
            </li>
          ))}
        </ol>
      )}
      <div className="ds-visually-hidden" role="status">
        <p>{turnSentence(view, capacity)}</p>
        <p>{announcement}</p>
      </div>
      <Composer view={view} capacity={capacity} run={run} busy={busy} onSent={announce} />
    </div>
  );
}
