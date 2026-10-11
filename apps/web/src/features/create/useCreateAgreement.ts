"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { randomId } from "@/features/document/ids.ts";
import { submitCreate, type CreateKeys, type CreatePhase, type UploadIntent } from "./submit.ts";
import { validateForm, type FormErrors, type FormValues } from "./validate.ts";

const newKeys = (): CreateKeys => ({
  create: `create-${randomId()}`,
  upload: `upload-${randomId()}`,
});

/** One user intent: the form it was made from, its keys, and the upload once first attempted. */
interface Attempt {
  readonly fingerprint: string;
  readonly keys: CreateKeys;
  upload: UploadIntent | null;
}

/**
 * Submitting the create form. One receipt key per intent: the same details retried reuse their
 * keys, so an uncertain failure never makes a second draft; changed details are a new intent with
 * new keys. Once the draft exists, a failed upload retries only the upload, with the same file,
 * key and draft version.
 */
export function useCreateAgreement() {
  const router = useRouter();
  const [phase, setPhase] = useState<CreatePhase>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
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
    const { file } = values;
    const fingerprint = JSON.stringify([checked.input, file?.name, file?.size]);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, keys: newKeys(), upload: null };
    }
    const current = attempt.current;
    const outcome = await submitCreate({
      input: checked.input,
      file: values.mode === "upload" ? file : null,
      keys: current.keys,
      createdId,
      upload: current.upload,
      onPhase: setPhase,
      onCreated: setCreatedId,
      onUploadIntent: (intent) => {
        current.upload = intent;
      },
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
