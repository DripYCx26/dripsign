"use client";

import type { SignatureFace } from "@dripsign/core/pdf/font";
import { LIMITS } from "@dripsign/core/schema";
import { Button, Checkbox, Notice, TextField } from "@/ui";
import { SignaturePreview } from "./SignaturePreview.tsx";
import { StepActions, StepFrame } from "./StepFrame.tsx";
import styles from "./SignStep.module.css";

type SignStepProps = Readonly<{
  /** The live round's frozen consent text: the words the signature binds. */
  consent: string;
  /** The name on the recipient's grant, offered as the field's placeholder, never as a value. */
  grantName: string;
  name: string;
  nameError: string | undefined;
  /** The face the signed PDF will draw the name in, from the server's name check. */
  nameFace: SignatureFace;
  agreed: boolean;
  pending: boolean;
  /** Reviewed, agreed, named, and the document is still the one that was reviewed. */
  canSign: boolean;
  /** The round or revision moved on after the review; signing is off until it is read again. */
  changed: boolean;
  /** A failure the signer can act on, other than a changed document. */
  failure: string | null;
  autoFocus: boolean;
  onName: (name: string) => void;
  onAgreed: (agreed: boolean) => void;
  onSign: () => void;
  onBack: () => void;
  onRestart: () => void;
}>;

/** Step 2: the consent text, the typed name with its preview, and the one irreversible action. */
export function SignStep(props: SignStepProps) {
  const { grantName, name, nameError, agreed, pending, canSign, changed, failure } = props;
  return (
    <StepFrame title="Sign the agreement" autoFocus={props.autoFocus}>
      {changed ? (
        <>
          <Notice tone="attention" live="alert">
            <strong>This document changed while you were signing.</strong>
            Read the latest version before you sign.
          </Notice>
          <StepActions>
            <Button variant="ink" size="lg" onClick={props.onRestart}>
              Review the latest version
            </Button>
          </StepActions>
        </>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (canSign) props.onSign();
          }}
        >
          <div className={styles.consent}>
            <p className={styles.label}>Consent</p>
            <p>{props.consent}</p>
          </div>
          <Checkbox
            label="I agree to sign electronically."
            checked={agreed}
            onChange={props.onAgreed}
          />
          <TextField
            label="Full name"
            name="typedName"
            autoComplete="name"
            size="lg"
            placeholder={grantName}
            value={name}
            maxLength={LIMITS.typedName}
            error={nameError}
            onChange={props.onName}
          />
          <SignaturePreview name={name.trim()} face={props.nameFace} />
          {failure !== null && (
            <Notice tone="stop" live="alert">
              {failure}
            </Notice>
          )}
          <StepActions>
            <Button
              variant="ink"
              size="lg"
              type="submit"
              loading={pending}
              disabled={!canSign && !pending}
            >
              {pending ? "Signing…" : "Sign agreement"}
            </Button>
            <Button variant="quiet" size="lg" disabled={pending} onClick={props.onBack}>
              Back to document
            </Button>
          </StepActions>
        </form>
      )}
    </StepFrame>
  );
}
