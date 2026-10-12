"use client";

import type { AgreementView } from "@dripsign/core/types";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { isBlankDraft, railMode } from "@/features/workspace/tabs.ts";
import { AssistantComposer } from "./AssistantComposer.tsx";
import styles from "./AssistantThread.module.css";
import { candidateOf, inOrder, type CandidatePreview } from "./candidate.ts";
import { Starters } from "./Starters.tsx";
import { TurnItem } from "./TurnCard.tsx";

type AssistantThreadProps = Readonly<{
  view: AgreementView;
  run: RunCommand;
  busy: boolean;
  /** Where the sheet previews the assistant's draft (the drafting rail); absent in the drawer. */
  preview?: CandidatePreview | undefined;
  /** A command failure, shown above the composer. */
  notice?: ReactNode;
}>;

/** Keeps the newest turn, and the reply that settles it, in view. */
function useScrollToNewest(list: RefObject<HTMLOListElement | null>, newestKey: string) {
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [newestKey, list]);
}

type GreetingProps = Readonly<{
  view: AgreementView;
  run: RunCommand;
  busy: boolean;
  /** The assistant can answer (or is answering); otherwise it is not set up here. */
  canAsk: boolean;
  /** The rail of a draft: starters belong there, and only while the draft is still the blank one. */
  drafting: boolean;
}>;

function greetingFor(canAsk: boolean, drafting: boolean): string {
  if (!canAsk) return "Start from a template, or write the terms with Edit draft.";
  return drafting
    ? "What are you drafting? Tell me who it’s between and what it covers — I can also check the legal side with you."
    : "Describe the change you need.";
}

/** The assistant's opening line, before any turn: static copy, not a stored reply. */
function Greeting({ view, run, busy, canAsk, drafting }: GreetingProps) {
  return (
    <li className={styles.greeting}>
      <p>{greetingFor(canAsk, drafting)}</p>
      {drafting && isBlankDraft(view) && <Starters view={view} run={run} busy={busy} />}
    </li>
  );
}

/**
 * The private assistant as a chat: staff describe what they need, the assistant asks what it must
 * know (offering to check the legal side), plans, then drafts for staff to apply, and the composer
 * stays pinned under the list. It is the drafting rail beside the sheet and, while negotiating,
 * the assistant drawer's body. Nothing here reaches recipients; the draft changes only when a
 * draft is applied.
 */
export function AssistantThread({ view, run, busy, preview, notice }: AssistantThreadProps) {
  const turns = inOrder(view.aiSuggestions);
  const candidateId = candidateOf(view.aiSuggestions)?.id ?? null;
  const newest = turns.at(-1);
  // Without ask_ai the assistant is either answering a queued turn (typing stays open) or off.
  const composing =
    view.allowedActions.includes("ask_ai") || turns.some((turn) => turn.status === "queued");
  const list = useRef<HTMLOListElement>(null);
  useScrollToNewest(list, newest === undefined ? "" : `${newest.id}:${newest.status}`);

  return (
    <div className={styles.pane}>
      <ol className={styles.list} ref={list} aria-label="Assistant conversation">
        {newest === undefined ? (
          <Greeting
            view={view}
            run={run}
            busy={busy}
            canAsk={composing}
            drafting={railMode(view) === "draft"}
          />
        ) : (
          turns.map((turn) => (
            <TurnItem
              key={turn.id}
              view={view}
              turn={turn}
              candidateId={candidateId}
              newest={turn === newest}
              run={run}
              busy={busy}
              preview={preview}
            />
          ))
        )}
      </ol>
      {notice}
      {/* With no assistant the box stays, disabled, so the rail still reads as a chat. */}
      <fieldset className={styles.dock} disabled={!composing}>
        {!composing && <p className={styles.off}>The assistant isn&rsquo;t set up here yet.</p>}
        <AssistantComposer view={view} turns={turns} run={run} busy={busy} />
      </fieldset>
    </div>
  );
}
