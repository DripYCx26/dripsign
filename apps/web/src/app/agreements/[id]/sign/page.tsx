import { SIGNING_VERIFICATION_MAX_AGE_MS } from "@dripsign/core/auth/sessions";
import { loadAgreementView } from "@dripsign/core/domain/view";
import { redirect } from "next/navigation";
import { CompletionPanel } from "@/features/signing/CompletionPanel.tsx";
import { FocusedFrame } from "@/features/signing/FocusedFrame.tsx";
import { SignFlow } from "@/features/signing/SignFlow.tsx";
import { SignUnavailable } from "@/features/signing/SignUnavailable.tsx";
import { SignedStep } from "@/features/signing/SignedStep.tsx";
import { signPageState } from "@/features/signing/state.ts";
import { requireRecipient } from "@/server/session.ts";

type SignPageProps = Readonly<{ params: Promise<{ id: string }> }>;

/** Not a component: the clock is read once per request, for the step the flow starts on. */
function verificationIsStale(verifiedAt: string): boolean {
  return Date.now() - Date.parse(verifiedAt) > SIGNING_VERIFICATION_MAX_AGE_MS;
}

/** The focused review-and-sign route for a required signer; anyone else is led back. */
export default async function SignPage({ params }: SignPageProps) {
  const { id } = await params;
  const { actor } = await requireRecipient(id);
  const view = await loadAgreementView(actor, id);
  const state = signPageState(view);
  // A finished agreement has nothing left to sign; its workspace holds the signed PDF.
  if (state === "completed") redirect(`/agreements/${id}`);
  return (
    <FocusedFrame title={view.agreement.title} exitHref={`/agreements/${id}`}>
      {state === "sign" && (
        <SignFlow
          agreementId={id}
          initialView={view}
          needsVerification={verificationIsStale(actor.verifiedAt)}
        />
      )}
      {state === "signed" && <SignedStep agreementId={id} view={view} autoFocus={false} />}
      {state === "finalizing" && <CompletionPanel view={view} />}
      {(state === "void" || state === "closed") && (
        <SignUnavailable agreementId={id} view={view} autoFocus={false} />
      )}
    </FocusedFrame>
  );
}
