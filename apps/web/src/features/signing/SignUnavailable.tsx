import type { AgreementView } from "@dripsign/core/types";
import { ButtonLink, Moment, Notice } from "@/ui";
import { StepFrame } from "./StepFrame.tsx";

type SignUnavailableProps = Readonly<{
  agreementId: string;
  view: AgreementView;
  autoFocus: boolean;
}>;

/** Signing is not open to this viewer: say why in one line and lead back to the agreement. */
export function SignUnavailable({ agreementId, view, autoFocus }: SignUnavailableProps) {
  const { status, voidedAt } = view.agreement;
  return (
    <StepFrame title="Signing isn’t open" autoFocus={autoFocus}>
      <Notice tone={status === "void" ? "stop" : "attention"} live="polite">
        {status === "void" && voidedAt !== null ? (
          <span>
            This agreement was voided on <Moment value={voidedAt} format="absolute" />.
          </span>
        ) : (
          <span>
            This signature request is no longer open to you. It may have been cancelled, or you may
            not be a required signer.
          </span>
        )}
      </Notice>
      <div>
        <ButtonLink variant="secondary" size="lg" href={`/agreements/${agreementId}`}>
          Back to agreement
        </ButtonLink>
      </div>
    </StepFrame>
  );
}
