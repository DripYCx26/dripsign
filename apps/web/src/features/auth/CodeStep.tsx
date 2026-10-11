"use client";

import { useState } from "react";
import { Button, CODE_LENGTH, CodeField } from "@/ui";
import styles from "./SignInFlow.module.css";

type CodeStepProps = Readonly<{
  email: string;
  pending: boolean;
  /** The last code was refused: the boxes are marked invalid. */
  refused: boolean;
  onSubmit: (code: string) => void;
  onChooseAnotherEmail: () => void;
}>;

/**
 * The second sign-in question: the six digits. Completing the sixth box submits; Continue does the
 * same for a code that was typed in pieces. The parent remounts this after a refusal, which clears
 * the boxes and puts focus back in the first.
 */
export function CodeStep({
  email,
  pending,
  refused,
  onSubmit,
  onChooseAnotherEmail,
}: CodeStepProps) {
  const [code, setCode] = useState("");
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(code);
      }}
    >
      <div role="status" className={styles.lead}>
        <p>If this address has access, a code is on its way.</p>
        <p className={styles.address}>{email}</p>
      </div>
      <CodeField
        label="Sign-in code"
        name="code"
        invalid={refused}
        disabled={pending}
        autoFocus
        onChange={setCode}
        onComplete={onSubmit}
      />
      <p className={styles.hint}>Code expires in 10 minutes.</p>
      <Button
        type="submit"
        variant="ink"
        size="lg"
        loading={pending}
        disabled={code.length !== CODE_LENGTH}
      >
        Continue
      </Button>
      <Button variant="quiet" onClick={onChooseAnotherEmail}>
        Use another email
      </Button>
    </form>
  );
}
