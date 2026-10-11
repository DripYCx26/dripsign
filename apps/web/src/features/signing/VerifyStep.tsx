"use client";

import { useState } from "react";
import { stepUpRequest, stepUpVerify } from "@/server/actions/auth.ts";
import { Button, CodeField, Notice } from "@/ui";
import { StepActions, StepFrame } from "./StepFrame.tsx";
import styles from "./VerifyStep.module.css";

type VerifyStepProps = Readonly<{
  email: string;
  autoFocus: boolean;
  /** The code was accepted; the session is fresh and the flow carries on where it was. */
  onVerified: () => void;
}>;

type Busy = "send" | "verify" | null;

const UNREACHABLE = "We couldn’t reach DripSign. Check your connection and try again.";

/** Runs a server action, turning a thrown network failure into a message. */
async function attempt(
  work: () => Promise<{ readonly ok: boolean; readonly message?: string }>,
): Promise<string | null> {
  try {
    const result = await work();
    return result.ok ? null : (result.message ?? UNREACHABLE);
  } catch {
    return UNREACHABLE;
  }
}

/** Step 0: a fresh email code in place, never a sign-out; nothing is sent until the signer asks. */
export function VerifyStep({ email, autoFocus, onVerified }: VerifyStepProps) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Remounting the code field is how a refused code is cleared.
  const [codeKey, setCodeKey] = useState(0);

  async function send() {
    setBusy("send");
    setMessage(null);
    const failure = await attempt(() => stepUpRequest());
    setBusy(null);
    setMessage(failure);
    if (failure === null) {
      setSent(true);
      setCodeKey((key) => key + 1);
    }
  }

  async function verify(code: string) {
    setBusy("verify");
    setMessage(null);
    const failure = await attempt(() => stepUpVerify({ code }));
    if (failure === null) {
      onVerified();
      return;
    }
    setBusy(null);
    setMessage(failure);
    setCodeKey((key) => key + 1);
  }

  return (
    <StepFrame title="Confirm it’s you." autoFocus={autoFocus}>
      {!sent && <p className={styles.note}>We’ll send a code to {email}.</p>}
      {message !== null && (
        <Notice tone="stop" live="alert">
          {message}
        </Notice>
      )}
      {sent ? (
        <div className={styles.entry}>
          <Notice tone="info" live="polite">
            Code sent to {email}. It expires in 10 minutes.
          </Notice>
          <CodeField
            key={codeKey}
            label="Verification code"
            name="code"
            autoFocus
            invalid={message !== null}
            disabled={busy !== null}
            onComplete={(code) => void verify(code)}
          />
          <StepActions>
            <Button variant="quiet" loading={busy === "send"} onClick={() => void send()}>
              Send a new code
            </Button>
          </StepActions>
        </div>
      ) : (
        <StepActions>
          <Button variant="ink" size="lg" loading={busy === "send"} onClick={() => void send()}>
            Send code
          </Button>
        </StepActions>
      )}
    </StepFrame>
  );
}
