"use client";

import { useState } from "react";
import type { CommandOf } from "@dripsign/core/schema";
import type { AgreementView, RoundView } from "@dripsign/core/types";
import { useCommand } from "@/features/command/useCommand.ts";
import { useNameCheck } from "./useNameCheck.ts";

/** What the signer reviewed: signing binds exactly this round, revision, document and consent. */
interface Reviewed {
  readonly roundId: string;
  readonly revisionId: string;
  readonly documentSha256: string;
  readonly consentVersion: string;
  readonly consentHash: string;
}

export type Stage = "verify" | "review" | "sign";

const freeze = (round: RoundView): Reviewed => ({
  roundId: round.id,
  revisionId: round.revisionId,
  documentSha256: round.documentSha256,
  consentVersion: round.consent.version,
  consentHash: round.consent.sha256,
});

const isCurrent = (reviewed: Reviewed, round: RoundView): boolean =>
  reviewed.roundId === round.id &&
  reviewed.revisionId === round.revisionId &&
  reviewed.documentSha256 === round.documentSha256;

interface Inputs {
  readonly view: AgreementView;
  readonly errorCode: string | null;
  readonly stage: Stage;
  readonly reviewed: Reviewed | null;
}

/** What the live view and the last refusal mean for the step on screen. */
function derive({ view, errorCode, stage, reviewed }: Inputs) {
  const round = view.activeRound?.status === "active" ? view.activeRound : null;
  // A server refusal for a stale verification replaces the step in place; clearing it returns.
  const stepUp = errorCode === "verification_required";
  // The round or revision moved on after the review: its checkbox no longer counts.
  const stale = reviewed !== null && round !== null && !isCurrent(reviewed, round);
  return {
    round,
    open: view.allowedActions.includes("sign"),
    stepUp,
    shown: stepUp ? ("verify" as const) : stage,
    stale,
    changed: !stepUp && (stale || errorCode === "conflict"),
  };
}

const signCommand = (reviewed: Reviewed, typedName: string): CommandOf<"sign"> => ({
  kind: "sign",
  ...reviewed,
  typedName,
});

/** What the signer has done so far; it outlives a step change, a step-up and a refresh. */
function useSignerInput() {
  const [reviewed, setReviewed] = useState<Reviewed | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState("");
  const { message: nameError, face: nameFace } = useNameCheck(name);
  const reset = () => {
    setReviewed(null);
    setAgreed(false);
  };
  return { reviewed, setReviewed, agreed, setAgreed, name, setName, nameError, nameFace, reset };
}

/**
 * The state and commands of the review-and-sign flow. The step is local state; everything the
 * signer must not lose (the review, the consent, the name) survives a step-up or a refresh. The
 * sign command carries the frozen review, never whatever round the live view shows now.
 */
export function useSignFlow(
  agreementId: string,
  initialView: AgreementView,
  needsVerification: boolean,
) {
  const { view, run, pending, error, clearError } = useCommand(
    agreementId,
    "recipient",
    initialView,
  );
  const [stage, setStage] = useState<Stage>(needsVerification ? "verify" : "review");
  const [moved, setMoved] = useState(false);
  const { reviewed, setReviewed, agreed, setAgreed, name, setName, nameError, nameFace, reset } =
    useSignerInput();
  const flow = derive({ view, errorCode: error?.code ?? null, stage, reviewed });
  const trimmed = name.trim();
  const canSign =
    reviewed !== null &&
    agreed &&
    trimmed !== "" &&
    nameError === undefined &&
    !flow.changed &&
    !pending;

  function goTo(next: Stage) {
    setStage(next);
    setMoved(true);
  }

  async function sign() {
    if (reviewed === null || !canSign) return;
    // A new name is a new intent: the receipt key never repeats with a different payload.
    await run(signCommand(reviewed, trimmed), `sign:${reviewed.roundId}:${trimmed}`);
  }

  return {
    view,
    round: flow.round,
    shown: flow.shown,
    open: flow.open,
    changed: flow.changed,
    canSign,
    pending,
    nameError,
    nameFace,
    name,
    agreed,
    reviewed: reviewed !== null && !flow.stale,
    // Focus follows an action, but a first load keeps focus where the browser put it.
    focusStep: moved || flow.stepUp,
    failure: error !== null && !flow.stepUp && !flow.changed ? error.message : null,
    setName,
    setAgreed,
    setReviewed: (checked: boolean) => {
      setReviewed(checked && flow.round !== null ? freeze(flow.round) : null);
    },
    toReview: () => {
      goTo("review");
    },
    toSign: () => {
      goTo("sign");
    },
    restart: () => {
      reset();
      clearError();
      goTo("review");
    },
    verified: () => {
      clearError();
      // The first step-up leads into the review; a mid-flow one returns to where it interrupted.
      goTo(stage === "verify" ? "review" : stage);
    },
    sign,
  };
}
