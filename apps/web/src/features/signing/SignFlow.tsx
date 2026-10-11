"use client";

import type { AgreementView } from "@dripsign/core/types";
import { fileUrl } from "@/features/files.ts";
import { ReviewStep } from "./ReviewStep.tsx";
import { SignedStep } from "./SignedStep.tsx";
import { SignStep } from "./SignStep.tsx";
import { SignStepper, type StepKey } from "./SignStepper.tsx";
import { SignUnavailable } from "./SignUnavailable.tsx";
import { useSignFlow } from "./useSignFlow.ts";
import { VerifyStep } from "./VerifyStep.tsx";

type SignFlowProps = Readonly<{
  agreementId: string;
  initialView: AgreementView;
  /** The session's email verification is older than the signing window. */
  needsVerification: boolean;
}>;

/** The focused review-and-sign flow: confirm (when needed), review, sign, done. */
export function SignFlow({ agreementId, initialView, needsVerification }: SignFlowProps) {
  const flow = useSignFlow(agreementId, initialView, needsVerification);
  const { view, round } = flow;
  const withConfirm = needsVerification || flow.shown === "verify";
  const steps: readonly StepKey[] = withConfirm
    ? ["verify", "review", "sign", "done"]
    : ["review", "sign", "done"];
  if (view.viewer.hasSigned) {
    return (
      <>
        <SignStepper steps={steps} current="done" />
        <SignedStep agreementId={agreementId} view={view} autoFocus />
      </>
    );
  }
  const revision = view.revisions.find((candidate) => candidate.id === round?.revisionId);
  if (!flow.open || round === null || revision === undefined) {
    return <SignUnavailable agreementId={agreementId} view={view} autoFocus={flow.focusStep} />;
  }
  const grantName = view.recipients.find((r) => r.id === view.viewer.recipientId)?.name ?? "";
  return (
    <>
      <SignStepper steps={steps} current={flow.shown} />
      {flow.shown === "verify" && (
        <VerifyStep
          email={view.viewer.email}
          autoFocus={flow.focusStep}
          onVerified={flow.verified}
        />
      )}
      {flow.shown === "review" && (
        <ReviewStep
          revision={revision}
          // The round's own revision, so the bytes read are the bytes the signature binds.
          src={fileUrl(agreementId, "revision", { rev: round.revisionNumber, as: "recipient" })}
          viewerRecipientId={view.viewer.recipientId}
          recipients={view.recipients}
          reviewed={flow.reviewed}
          autoFocus={flow.focusStep}
          onReviewed={flow.setReviewed}
          onContinue={flow.toSign}
        />
      )}
      {flow.shown === "sign" && (
        <SignStep
          grantName={grantName}
          name={flow.name}
          nameError={flow.nameError}
          agreed={flow.agreed}
          pending={flow.pending}
          canSign={flow.canSign}
          changed={flow.changed}
          failure={flow.failure}
          autoFocus={flow.focusStep}
          onName={flow.setName}
          onAgreed={flow.setAgreed}
          onSign={() => void flow.sign()}
          onBack={flow.toReview}
          onRestart={flow.restart}
        />
      )}
    </>
  );
}
