import type { AgreementView } from "@dripsign/core/types";
import { BadgeCheck, ButtonLink, Moment } from "@/ui";
import { shortHash } from "./format.ts";
import { StepActions, StepFrame } from "./StepFrame.tsx";
import styles from "./SignedStep.module.css";

type SignedStepProps = Readonly<{
  agreementId: string;
  view: AgreementView;
  autoFocus: boolean;
}>;

/** Step 3: the receipt for the signer’s own signature and what happens next. */
export function SignedStep({ agreementId, view, autoFocus }: SignedStepProps) {
  const round = view.activeRound ?? view.completedRound;
  const own = round?.signers.find((signer) => signer.recipientId === view.viewer.recipientId);
  const signedAt = own?.signature?.signedAt;
  const signed = round?.signers.filter((signer) => signer.signature !== null).length ?? 0;
  const everyone = round !== null && signed === round.signers.length;
  return (
    <StepFrame title="Your signature is recorded." icon={<BadgeCheck />} autoFocus={autoFocus}>
      {round !== null && (
        <dl className={styles.facts}>
          {signedAt !== undefined && (
            <div>
              <dt>Signed</dt>
              <dd>
                <Moment value={signedAt} format="absolute" />
              </dd>
            </div>
          )}
          <div>
            <dt>Document</dt>
            <dd className={styles.hash}>{shortHash(round.documentSha256)}</dd>
          </div>
          <div>
            <dt>Progress</dt>
            <dd>
              {signed} of {round.signers.length} signed
            </dd>
          </div>
        </dl>
      )}
      <p className={styles.next}>
        {everyone
          ? "Everyone has signed. The signed PDF and audit record are being prepared, and you’ll get an email with a link to them."
          : "When everyone has signed, you’ll get an email with a link to the signed PDF and audit record."}
      </p>
      <StepActions>
        <ButtonLink variant="secondary" size="lg" href={`/agreements/${agreementId}`}>
          Back to agreement
        </ButtonLink>
      </StepActions>
    </StepFrame>
  );
}
