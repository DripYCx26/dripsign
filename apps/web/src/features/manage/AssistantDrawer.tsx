"use client";

import { LIMITS } from "@dripsign/core/schema";
import type { AgreementView, AiSuggestionView } from "@dripsign/core/types";
import { useState } from "react";
import { SectionDiff } from "@/features/document/SectionDiff.tsx";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { Button, Drawer, Notice, Pill, TextArea } from "@/ui";
import styles from "./AssistantDrawer.module.css";
import type { PanelProps } from "./panel.ts";

type CardProps = Readonly<{
  view: AgreementView;
  suggestion: AiSuggestionView;
  run: RunCommand;
  busy: boolean;
}>;

function ReadyCard({ view, suggestion, run, busy }: CardProps) {
  const result = suggestion.result;
  if (result === null) return null;
  const applied = suggestion.status === "applied";
  const canApply = !applied && !suggestion.stale && view.allowedActions.includes("apply_ai");

  function use() {
    void run(
      { kind: "apply_ai", expectedVersion: view.agreement.version, suggestionId: suggestion.id },
      `apply_ai:${suggestion.id}`,
    );
  }

  return (
    <>
      <p className={styles.summary}>{result.summary}</p>
      {!applied && <SectionDiff before={view.draft?.source ?? null} after={result.source} />}
      {result.questions.length > 0 && (
        <section className={styles.questions}>
          <h3>Questions to review</h3>
          <ul>
            {result.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </section>
      )}
      {applied && <Pill tone="confirm">Used as draft</Pill>}
      {!applied && suggestion.stale && (
        <Notice tone="attention">
          The draft changed after this was requested, so it can&rsquo;t be used. Ask again.
        </Notice>
      )}
      {canApply && (
        <div>
          <Button variant="ink" disabled={busy} onClick={use}>
            Use as draft
          </Button>
        </div>
      )}
    </>
  );
}

function SuggestionCard(props: CardProps) {
  const { view, suggestion, run, busy } = props;
  const canAsk = view.allowedActions.includes("ask_ai");
  return (
    <li className={styles.card}>
      <p className={styles.instruction}>{suggestion.instruction}</p>
      {suggestion.status === "queued" && (
        <Notice tone="info" live="polite">
          Drafting suggestions…
        </Notice>
      )}
      {suggestion.status === "failed" && (
        <>
          <Notice tone="stop" live="alert">
            Suggestions couldn&rsquo;t be prepared.
          </Notice>
          <div>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !canAsk}
              onClick={() => {
                void run({ kind: "ask_ai", instruction: suggestion.instruction }, "ask_ai");
              }}
            >
              Try again
            </Button>
          </div>
        </>
      )}
      {(suggestion.status === "ready" || suggestion.status === "applied") && (
        <ReadyCard {...props} />
      )}
    </li>
  );
}

/**
 * The private assistant: staff ask for wording help, each answer waits as a card until staff use it
 * as the draft. Nothing here reaches recipients; the draft only changes when a card is used.
 */
export function AssistantDrawer({ open, view, run, busy, notice, onClose }: PanelProps) {
  const [instruction, setInstruction] = useState("");
  const canAsk = view.allowedActions.includes("ask_ai");
  const suggestions = [...view.aiSuggestions].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

  async function ask() {
    if (await run({ kind: "ask_ai", instruction }, "ask_ai")) setInstruction("");
  }

  return (
    <Drawer open={open} title="Private assistant" width={640} onClose={onClose}>
      <div className={styles.drawer}>
        <p className={styles.subtitle}>
          Only your team sees this. Nothing changes until you publish.
        </p>
        <form
          className={styles.ask}
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <TextArea
            label="What should it change?"
            name="assistant-instruction"
            maxLength={LIMITS.aiInstruction}
            value={instruction}
            onChange={setInstruction}
            disabled={!canAsk}
          />
          <Button
            variant="ink"
            type="submit"
            loading={busy}
            disabled={!canAsk || busy || instruction.trim() === ""}
          >
            Get suggestions
          </Button>
        </form>
        {notice}
        <ul className={styles.list}>
          {suggestions.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              view={view}
              suggestion={suggestion}
              run={run}
              busy={busy}
            />
          ))}
        </ul>
      </div>
    </Drawer>
  );
}
