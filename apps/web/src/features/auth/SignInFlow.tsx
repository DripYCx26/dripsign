"use client";

import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";
import { formText } from "@/features/shell/formText.ts";
import { settle } from "@/features/shell/settle.ts";
import { requestCode, verifyCode } from "@/server/actions/auth.ts";
import { CODE_LENGTH, Notice } from "@/ui";
import { CodeStep } from "./CodeStep.tsx";
import { EmailStep } from "./EmailStep.tsx";
import styles from "./SignInFlow.module.css";

type Step = Readonly<{ kind: "email" } | { kind: "code"; email: string }>;

/**
 * Email, then the six-digit code. The server decides where a verified person lands (the sign-in
 * page redirects a signed-in visitor to `next`, else their home), so success only refreshes.
 */
export function SignInFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Bumped after a refused code so the boxes clear and focus returns to the first.
  const [attempt, setAttempt] = useState(0);

  async function sendCode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const email = formText(new FormData(event.currentTarget), "email");
    setPending(true);
    setProblem(null);
    const result = await settle(requestCode({ email }));
    setPending(false);
    if (result.ok) setStep({ kind: "code", email });
    else setProblem(result.message);
  }

  async function submitCode(code: string) {
    if (pending || code.length !== CODE_LENGTH) return;
    setPending(true);
    setProblem(null);
    const result = await settle(verifyCode({ code }));
    if (result.ok) {
      router.refresh();
      return;
    }
    setPending(false);
    setProblem(result.message);
    setAttempt((count) => count + 1);
  }

  return (
    <div className={styles.flow}>
      {problem !== null && (
        <Notice tone="stop" live="alert">
          {problem}
        </Notice>
      )}
      {step.kind === "email" ? (
        <EmailStep pending={pending} onSubmit={(event) => void sendCode(event)} />
      ) : (
        <CodeStep
          key={attempt}
          email={step.email}
          pending={pending}
          refused={problem !== null}
          onSubmit={(code) => void submitCode(code)}
          onChooseAnotherEmail={() => {
            setStep({ kind: "email" });
            setProblem(null);
          }}
        />
      )}
    </div>
  );
}
