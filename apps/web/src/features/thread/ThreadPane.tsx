"use client";

import type { AgreementView, Capacity, ProposalView } from "@dripsign/core/types";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { PENDING_PROPOSAL_ID } from "@/features/workspace/nextStep.ts";
import { EmptyState } from "@/ui";
import { Composer, type ComposerMode, type Sent } from "./Composer.tsx";
import { MessageItem } from "./MessageItem.tsx";
import { isOwn, pendingProposal, threadItems } from "./model.ts";
import { ProposalCard, type Decision } from "./ProposalCard.tsx";
import styles from "./ThreadPane.module.css";
import { TurnBanner } from "./TurnBanner.tsx";

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

/**
 * After a send, focus moves to the new item and a polite live region says what happened. The item
 * arrives with the refreshed view, which may land before or after the command resolves, so the
 * focus waits for the list to grow past its length at the moment of sending.
 */
function useSentFeedback(itemCount: number) {
  const list = useRef<HTMLOListElement>(null);
  const growPast = useRef<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");

  const focusNewest = useCallback(() => {
    const items = list.current?.children;
    if (growPast.current === null || items === undefined || items.length <= growPast.current) {
      return;
    }
    growPast.current = null;
    const newest = items[items.length - 1];
    if (newest instanceof HTMLElement) newest.focus();
  }, []);

  useEffect(focusNewest, [itemCount, focusNewest]);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  function sent(kind: Sent) {
    growPast.current = itemCount;
    window.requestAnimationFrame(focusNewest);
    setAnnouncement(ANNOUNCEMENT[kind]);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setAnnouncement("");
    }, ANNOUNCEMENT_MS);
  }

  return { list, announcement, sent };
}

/**
 * Opens the thread at its newest end, where the turn and the composer are. An item taller than the
 * list (a long proposal) opens at its own top, so its title is never scrolled out of sight.
 */
function useOpenAtNewest(list: RefObject<HTMLOListElement | null>, itemCount: number) {
  useEffect(() => {
    const element = list.current;
    const newest = element?.lastElementChild;
    if (element === null || newest == null) return;
    const newestTop = newest.getBoundingClientRect().top - element.getBoundingClientRect().top;
    const end = element.scrollHeight - element.clientHeight;
    element.scrollTo({ top: Math.min(end, element.scrollTop + newestTop) });
  }, [itemCount, list]);
}

/**
 * The proposal thread: whose turn it is, the conversation oldest first as an ordered list, and the
 * composer. Staff and recipients see the same list; the view already filtered what each may see.
 */
export function ThreadPane({ view, capacity, run, busy }: ThreadPaneProps) {
  const items = threadItems(view);
  const pendingId = pendingProposal(view)?.id;
  const [mode, setMode] = useState<ComposerMode>("message");
  const { list, announcement, sent } = useSentFeedback(items.length);

  useOpenAtNewest(list, items.length);

  async function decide(decision: Decision, proposal: ProposalView) {
    await run(
      decision === "accept"
        ? { kind: "accept", expectedVersion: view.agreement.version, proposalId: proposal.id }
        : { kind: "reject", expectedVersion: view.agreement.version, proposalId: proposal.id },
      `${decision}:${proposal.id}`,
    );
  }

  function counter() {
    setMode("propose");
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("#composer select, #composer textarea")?.focus();
    });
  }

  return (
    <div className={styles.pane}>
      <TurnBanner view={view} capacity={capacity} />
      {items.length === 0 ? (
        <EmptyState message="No messages or proposals yet." />
      ) : (
        <ol className={styles.list} ref={list} aria-label="Thread">
          {items.map((item) => (
            <li
              key={item.key}
              className={styles.item}
              id={
                item.kind === "proposal" && item.proposal.id === pendingId
                  ? PENDING_PROPOSAL_ID
                  : undefined
              }
              tabIndex={-1}
            >
              {item.kind === "message" ? (
                <MessageItem message={item.message} own={isOwn(item.message.author, view)} />
              ) : (
                <ProposalCard
                  view={view}
                  capacity={capacity}
                  proposal={item.proposal}
                  busy={busy}
                  onDecide={decide}
                  onCounter={counter}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="ds-visually-hidden" role="status">
        {announcement}
      </p>
      <Composer
        view={view}
        capacity={capacity}
        run={run}
        busy={busy}
        mode={mode}
        onModeChange={setMode}
        onSent={sent}
      />
    </div>
  );
}
