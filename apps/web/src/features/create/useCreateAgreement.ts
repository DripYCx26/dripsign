"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { randomId } from "@/features/document/ids.ts";
import { submitCreate } from "./submit.ts";
import { validateForm, type FormErrors, type FormValues } from "./validate.ts";

/** One user intent: the details it was made from and its receipt key. */
interface Attempt {
  readonly fingerprint: string;
  readonly key: string;
}

/**
 * Submitting the create form. One receipt key per intent: the same details retried reuse their
 * key, so an uncertain failure never makes a second draft; changed details are a new intent with a
 * new key.
 */
export function useCreateAgreement() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors | null>(null);
  // Read only inside submit, never rendered, so a ref: a retry must see the intent as left.
  const attempt = useRef<Attempt | null>(null);

  async function submit(values: FormValues) {
    const checked = validateForm(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      setProblem(checked.errors.general ?? null);
      return;
    }
    setErrors(null);
    setProblem(null);
    const fingerprint = JSON.stringify(checked.input);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: `create-${randomId()}` };
    }
    setBusy(true);
    const outcome = await submitCreate(checked.input, attempt.current.key);
    if (!outcome.ok) {
      setProblem(outcome.message);
      setBusy(false);
      return;
    }
    router.push(`/staff/agreements/${outcome.id}`);
  }

  return { busy, problem, errors, submit };
}
