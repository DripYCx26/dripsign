"use client";

import { LIMITS } from "@dripsign/core/schema";
import type { AgreementView, AiSuggestionView } from "@dripsign/core/types";
import { useState } from "react";
import { ComposerBox } from "@/features/thread/Composer.tsx";
import { textScope } from "@/features/thread/model.ts";
import { useAutosize } from "@/features/thread/useAutosize.ts";
import { useStoredText } from "@/features/thread/useStoredText.ts";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { Button } from "@/ui";
import { composerMode } from "./turnMode.ts";

type AssistantComposerProps = Readonly<{
  view: AgreementView;
  turns: readonly AiSuggestionView[];
  run: RunCommand;
  busy: boolean;
}>;

function placeholderFor(turns: number, drafting: boolean): string {
  if (turns === 0) return "A services agreement for a 12-week website build, fixed fee, net 30…";
  return drafting ? "Ask for a change to the draft…" : "Answer the questions or add detail…";
}

/**
 * The assistant's composer, the house chat box. Words are a plan request until the assistant has
 * written a draft, then a refinement; "Ask without drafting" makes one turn a question only. The
 * text is kept like a message's and cleared only once the request was accepted.
 */
export function AssistantComposer({ view, turns, run, busy }: AssistantComposerProps) {
  const [stored, setStored, clearSent] = useStoredText(textScope(view, "staff"), "assistant");
  const [questionOnly, setQuestionOnly] = useState(false);
  const text = stored ?? "";
  const field = useAutosize(text);
  const refining = composerMode(turns, false) === "draft";
  // Typing stays open while a turn is queued; sending waits for the policy to allow the next one.
  const ready = text.trim() !== "" && !busy && view.allowedActions.includes("ask_ai");

  async function send() {
    if (!ready) return;
    const mode = composerMode(turns, questionOnly);
    if (await run({ kind: "ask_ai", mode, instruction: text }, "ask_ai")) {
      clearSent(stored);
      setQuestionOnly(false);
      field.current?.focus();
    }
  }

  return (
    <ComposerBox
      fieldId="assistant-field"
      fieldRef={field}
      label="Message the assistant"
      placeholder={placeholderFor(turns.length, refining)}
      maxLength={LIMITS.aiInstruction}
      value={text}
      ready={ready}
      onChange={setStored}
      onSend={() => void send()}
      foot={
        refining && (
          <Button
            variant="quiet"
            size="sm"
            pressed={questionOnly}
            onClick={() => {
              setQuestionOnly((current) => !current);
            }}
          >
            Ask without drafting
          </Button>
        )
      }
    />
  );
}
