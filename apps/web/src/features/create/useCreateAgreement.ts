"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { randomId } from "@/features/document/ids.ts";
import { submitCreate, type CreateKeys, type CreatePhase } from "./submit.ts";
import { validateForm, type FormErrors, type FormValues } from "./validate.ts";

const newKeys = (): CreateKeys => ({
  create: `create-${randomId()}`,
  upload: `upload-${randomId()}`,
});

/**
 * Submitting the create form. One receipt key per intent: the same details retried reuse their
 * keys, so an uncertain failure never makes a second draft; changed details are a new intent with
 * new keys. Once the draft exists, a failed upload retries only the upload.
 */
export function useCreateAgreement() {
  const router = useRouter();
  const [phase, setPhase] = useState<CreatePhase>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<{ fingerprint: string; keys: CreateKeys } | null>(null);

  async function submit(values: FormValues) {
    const checked = validateForm(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      setProblem(checked.errors.general ?? null);
      return;
    }
    setErrors(null);
    setProblem(null);
    const { file } = values;
    const fingerprint = JSON.stringify([checked.input, file?.name, file?.size]);
    const keys = attempt?.fingerprint === fingerprint ? attempt.keys : newKeys();
    setAttempt({ fingerprint, keys });
    const outcome = await submitCreate({
      input: checked.input,
      file: values.mode === "upload" ? file : null,
      keys,
      createdId,
      onPhase: setPhase,
      onCreated: setCreatedId,
    });
    if (!outcome.ok) {
      setProblem(outcome.message);
      setPhase("idle");
      return;
    }
    router.push(`/staff/agreements/${outcome.id}`);
  }

  return { phase, busy: phase !== "idle", problem, errors, createdId, submit };
}
