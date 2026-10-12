"use client";

import { LIMITS } from "@dripsign/core/schema";
import type { AgreementView, Capacity } from "@dripsign/core/types";
import { useEffect, type ReactNode, type RefObject } from "react";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { ArrowUp, Button, IconButton, Pencil } from "@/ui";
import styles from "./Composer.module.css";
import { sendOnEnter } from "./enterToSend.ts";
import { cancelProposal, startProposal, useProposalIntent, type ProposalIntent } from "./intent.ts";
import { counterTarget, MESSAGE_FIELD_ID, otherSideLabel, textScope } from "./model.ts";
import { ProposalComposer } from "./ProposalComposer.tsx";
import { useAutosize } from "./useAutosize.ts";
import { useStoredText, type TextScope } from "./useStoredText.ts";

export type Sent = "message" | "proposal";

type ComposerProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
  run: RunCommand;
  busy: boolean;
  onSent: (sent: Sent) => void;
}>;

type ComposerBoxProps = Readonly<{
  /** The dock's id, for the jump to the composer. */
  id?: string | undefined;
  fieldId: string;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  label: string;
  placeholder: string;
  maxLength: number;
  value: string;
  /** There is text and nothing is in flight. */
  ready: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  /** The quiet row under the field: buttons, if any. */
  foot?: ReactNode;
}>;

/**
 * The house chat box, docked under a list: one growing field, Enter to send, a round Send. The
 * message composer and the assistant's share it; what sending means is the caller's.
 */
export function ComposerBox({
  id,
  fieldId,
  fieldRef,
  label,
  placeholder,
  maxLength,
  value,
  ready,
  onChange,
  onSend,
  foot,
}: ComposerBoxProps) {
  return (
    <div className={styles.composer} id={id}>
      <form
        className={styles.box}
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <div className={styles.row}>
          <textarea
            id={fieldId}
            ref={fieldRef}
            className={styles.field}
            rows={1}
            aria-label={label}
            placeholder={placeholder}
            maxLength={maxLength}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            onKeyDown={(event) => {
              sendOnEnter(event, onSend);
            }}
          />
          <IconButton
            variant="ink"
            shape="round"
            type="submit"
            label="Send"
            icon={<ArrowUp />}
            disabled={!ready}
          />
        </div>
        {foot ? <div className={styles.foot}>{foot}</div> : null}
      </form>
    </div>
  );
}

type MessageComposerProps = Readonly<{
  view: AgreementView;
  scope: TextScope;
  run: RunCommand;
  busy: boolean;
  canPropose: boolean;
  onSent: () => void;
}>;

function MessageComposer({ view, scope, run, busy, canPropose, onSent }: MessageComposerProps) {
  const [stored, setStored, clearSent] = useStoredText(scope, "message");
  const text = stored ?? "";
  const field = useAutosize(text);
  const ready = text.trim() !== "" && !busy;

  async function send() {
    if (!ready) return;
    if (await run({ kind: "message", body: text }, "message")) {
      clearSent(stored);
      onSent();
      field.current?.focus();
    }
  }

  return (
    <ComposerBox
      id="composer"
      fieldId={MESSAGE_FIELD_ID}
      fieldRef={field}
      label="Message"
      placeholder={`Message ${otherSideLabel(view, scope.capacity)}`}
      maxLength={LIMITS.messageText}
      value={text}
      ready={ready}
      onChange={setStored}
      onSend={() => void send()}
      foot={
        canPropose && (
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              startProposal({});
            }}
          >
            <Pencil />
            Propose a change
          </Button>
        )
      }
    />
  );
}

/**
 * Whether the intent still describes something the viewer may do: countering the other side's
 * open proposal (a section edit from the document then counters it too), or a fresh proposal
 * when none is open.
 */
function intentStands(
  intent: ProposalIntent,
  target: ReturnType<typeof counterTarget>,
  canPropose: boolean,
): boolean {
  if (target !== null) return intent.counterOf === undefined || intent.counterOf === target.id;
  return intent.counterOf === undefined && canPropose;
}

/**
 * The composer, pinned under the thread. A message by default; proposing replaces it while an
 * intent (from "Propose a change", a document section or a Counter) stands. Text is kept in
 * session storage and cleared only once the command succeeded, and only if nothing was typed
 * while it was in flight.
 */
export function Composer({ view, capacity, run, busy, onSent }: ComposerProps) {
  const scope = textScope(view, capacity);
  const intent = useProposalIntent();
  const target = counterTarget(view, capacity);
  const canMessage = view.allowedActions.includes("message");
  const canPropose = view.allowedActions.includes("propose");
  const proposing = intent !== null && intentStands(intent, target, canPropose);

  // An intent the policy no longer allows (the other side proposed meanwhile) is dropped, not kept.
  useEffect(() => {
    if (intent !== null && !proposing) cancelProposal();
  }, [intent, proposing]);

  if (proposing) {
    return (
      <div className={styles.composer} id="composer">
        <ProposalComposer
          view={view}
          scope={scope}
          intent={intent}
          target={target}
          run={run}
          busy={busy}
          onSent={() => {
            onSent("proposal");
          }}
        />
      </div>
    );
  }
  if (!canMessage && !canPropose) return null;
  return (
    <MessageComposer
      view={view}
      scope={scope}
      run={run}
      busy={busy}
      canPropose={canPropose}
      onSent={() => {
        onSent("message");
      }}
    />
  );
}
