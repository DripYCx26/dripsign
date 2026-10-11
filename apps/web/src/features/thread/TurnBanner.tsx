import type { AgreementView, Capacity } from "@dripsign/core/types";
import { Notice } from "@/ui";
import { describeChange, otherSideLabel, pendingProposal } from "./model.ts";

type Turn = Readonly<{ tone: "attention" | "info"; text: string }>;

/** Whose move it is, in one sentence; null when the thread is closed to proposals. */
function turnOf(view: AgreementView, capacity: Capacity): Turn | null {
  const pending = pendingProposal(view);
  if (pending !== null) {
    if (pending.author.capacity !== capacity) {
      const change = describeChange(view, pending);
      return { tone: "attention", text: `Your turn: ${pending.author.label} proposed ${change}.` };
    }
    return { tone: "info", text: `Waiting for ${otherSideLabel(view, capacity)} to respond.` };
  }
  if (!view.allowedActions.includes("propose")) return null;
  if (capacity === "recipient" && view.activeRound?.status === "active") {
    return { tone: "attention", text: "Proposing a change cancels the current signature request." };
  }
  return { tone: "info", text: "No open proposal. Send a message or propose a change." };
}

/**
 * The thread's status line. The status region is always mounted and only its content changes, so a
 * change of turn is announced as it happens.
 */
export function TurnBanner({
  view,
  capacity,
}: Readonly<{ view: AgreementView; capacity: Capacity }>) {
  const turn = turnOf(view, capacity);
  return <div role="status">{turn !== null && <Notice tone={turn.tone}>{turn.text}</Notice>}</div>;
}
