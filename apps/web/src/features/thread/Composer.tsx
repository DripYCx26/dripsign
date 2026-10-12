"use client";

import { LIMITS } from "@dripsign/core/schema";
import type { AgreementView, Capacity } from "@dripsign/core/types";
import { useEffect } from "react";
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
    <form
      className={styles.box}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className={styles.row}>
        <textarea
          id={MESSAGE_FIELD_ID}
          ref={field}
          className={styles.field}
          rows={1}
          aria-label="Message"
          placeholder={`Message ${otherSideLabel(view, scope.capacity)}`}
          maxLength={LIMITS.messageText}
          value={text}
          onChange={(event) => {
            setStored(event.target.value);
          }}
          onKeyDown={(event) => {
            sendOnEnter(event, () => void send());
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
      {canPropose && (
        <div className={styles.foot}>
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
        </div>
      )}
    </form>
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
    <div className={styles.composer} id="composer">
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
    </div>
  );
}
