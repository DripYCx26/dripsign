"use client";

import type { AgreementView } from "@dripsign/core/types";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { isBlankDraft, railMode } from "@/features/workspace/tabs.ts";
import { EmptyState, FilePen, Sparkles } from "@/ui";
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

type WelcomeProps = Readonly<{
  view: AgreementView;
  run: RunCommand;
  busy: boolean;
  canAsk: boolean;
  /** The rail of a draft: starters belong there, and only while the draft is still the blank one. */
  drafting: boolean;
}>;

function Welcome({ view, run, busy, canAsk, drafting }: WelcomeProps) {
  const blank = drafting && isBlankDraft(view);
  const starters = blank ? <Starters view={view} run={run} busy={busy} /> : undefined;
  if (canAsk) {
    return (
      <EmptyState
        icon={<Sparkles />}
        message={drafting ? "Describe the agreement you need." : "Describe the change you need."}
        detail="Only your team sees this. Nothing changes until you apply a draft."
        action={starters}
      />
    );
  }
  return (
    <EmptyState
      icon={<FilePen />}
      message="Start from a template or write the terms."
      detail="Edit the draft from the bar."
      action={starters}
    />
  );
}

/**
 * The private assistant as a chat: staff describe what they need, the assistant answers with a
 * plan to confirm and then a draft to apply, and the composer stays pinned under the list. It is
 * the drafting rail beside the sheet and, while negotiating, the assistant drawer's body. Nothing
 * here reaches recipients; the draft changes only when a draft is applied.
 */
export function AssistantThread({ view, run, busy, preview, notice }: AssistantThreadProps) {
  const turns = inOrder(view.aiSuggestions);
  const candidateId = candidateOf(view.aiSuggestions)?.id ?? null;
  const canAsk = view.allowedActions.includes("ask_ai");
  const newest = turns.at(-1);
  // A queued turn withholds ask_ai, but the composer stays so staff can type the next request.
  const composing = canAsk || turns.some((turn) => turn.status === "queued");
  const list = useRef<HTMLOListElement>(null);
  useScrollToNewest(list, newest === undefined ? "" : `${newest.id}:${newest.status}`);

  return (
    <div className={styles.pane}>
      {newest === undefined ? (
        <div className={styles.welcome}>
          <Welcome
            view={view}
            run={run}
            busy={busy}
            canAsk={canAsk}
            drafting={railMode(view) === "draft"}
          />
        </div>
      ) : (
        <ol className={styles.list} ref={list} aria-label="Assistant conversation">
          {turns.map((turn) => (
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
          ))}
        </ol>
      )}
      {notice}
      {composing && <AssistantComposer view={view} turns={turns} run={run} busy={busy} />}
    </div>
  );
}
