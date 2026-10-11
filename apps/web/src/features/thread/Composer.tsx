"use client";

import { LIMITS } from "@dripsign/core/schema";
import type { AgreementView, Capacity } from "@dripsign/core/types";
import type { SubmitEvent } from "react";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { Button, Notice, Segmented, TextArea } from "@/ui";
import styles from "./Composer.module.css";
import { counterTarget } from "./model.ts";
import { ProposeForm } from "./ProposeForm.tsx";
import { useStoredText } from "./useStoredText.ts";

export type ComposerMode = "message" | "propose";
export type Sent = "message" | "proposal";

type ComposerProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
  run: RunCommand;
  busy: boolean;
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
  onSent: (sent: Sent) => void;
}>;

function MessageForm({
  agreementId,
  run,
  busy,
  onSent,
}: Readonly<{ agreementId: string; run: RunCommand; busy: boolean; onSent: () => void }>) {
  const [stored, setStored] = useStoredText(agreementId, "message");
  const text = stored ?? "";

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (await run({ kind: "message", body: text }, "message")) {
      setStored(null);
      onSent();
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <TextArea
        label="Message"
        name="message"
        maxLength={LIMITS.messageText}
        hint="Messages don't change the document."
        value={text}
        onChange={setStored}
      />
      <Button variant="ink" type="submit" disabled={text.trim() === "" || busy} loading={busy}>
        Send message
      </Button>
    </form>
  );
}

/** What stands where the composer would be when nothing can be sent. */
function Closed({ view }: Readonly<{ view: AgreementView }>) {
  const text =
    view.agreement.status === "draft"
      ? "The thread opens when you publish the first revision."
      : "The thread is read-only.";
  return <Notice tone="info">{text}</Notice>;
}

/**
 * The composer: "Message" or "Propose change", whichever the policy allows. The text of each lives
 * in session storage per agreement, so a refresh or a conflict reload never loses it; it is cleared
 * only once the command succeeded.
 */
export function Composer({ view, capacity, run, busy, mode, onModeChange, onSent }: ComposerProps) {
  const target = counterTarget(view, capacity);
  const canMessage = view.allowedActions.includes("message");
  const canPropose = view.allowedActions.includes("propose") || target !== null;
  if (!canMessage && !canPropose) return <Closed view={view} />;
  const active: ComposerMode =
    canPropose && (mode === "propose" || !canMessage) ? "propose" : "message";

  return (
    <div className={styles.composer} id="composer">
      {canMessage && canPropose && (
        <Segmented
          label="What to send"
          hideLabel
          name="composer-mode"
          options={[
            { value: "message", label: "Message" },
            { value: "propose", label: "Propose change" },
          ]}
          value={active}
          onChange={onModeChange}
        />
      )}
      {active === "message" ? (
        <MessageForm
          agreementId={view.agreement.id}
          run={run}
          busy={busy}
          onSent={() => {
            onSent("message");
          }}
        />
      ) : (
        <>
          {target !== null && (
            <p className={styles.note}>{`Answering ${target.author.label}'s open proposal.`}</p>
          )}
          <ProposeForm
            view={view}
            run={run}
            busy={busy}
            target={target}
            onSent={() => {
              onSent("proposal");
            }}
          />
        </>
      )}
    </div>
  );
}
