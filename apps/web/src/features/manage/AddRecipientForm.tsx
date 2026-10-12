"use client";

import { newRecipientSchema } from "@dripsign/core/schema";
import type { AgreementView } from "@dripsign/core/types";
import { useState, type SubmitEvent } from "react";
import type { RunCommand } from "@/features/workspace/commands.ts";
import { Button, Checkbox, TextField } from "@/ui";
import styles from "./RecipientsDrawer.module.css";

type Problems = Readonly<{ name?: string; email?: string }>;

type AddRecipientFormProps = Readonly<{ view: AgreementView; run: RunCommand; busy: boolean }>;

/** Add a person inline. The same schema the server runs checks the fields first. */
export function AddRecipientForm({ view, run, busy }: AddRecipientFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSigner, setIsSigner] = useState(true);
  const [problems, setProblems] = useState<Problems>({});
  const published = view.agreement.currentRevisionNumber !== null;

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const parsed = newRecipientSchema.safeParse({ name, email, isSigner });
    if (!parsed.success) {
      const found: { name?: string; email?: string } = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if ((field === "name" || field === "email") && found[field] === undefined) {
          found[field] = issue.message;
        }
      }
      setProblems(found);
      return;
    }
    setProblems({});
    const added = await run(
      { kind: "add_recipient", expectedVersion: view.agreement.version, ...parsed.data },
      "add_recipient",
    );
    if (added) {
      setName("");
      setEmail("");
    }
  }

  return (
    <form className={styles.add} onSubmit={(event) => void submit(event)} noValidate>
      <h3 className={styles.addTitle}>Add a recipient</h3>
      <TextField
        label="Name"
        name="recipient-name"
        autoComplete="off"
        value={name}
        onChange={setName}
        disabled={busy}
        error={problems.name}
      />
      <TextField
        label="Email"
        name="recipient-email"
        type="email"
        autoComplete="off"
        value={email}
        onChange={setEmail}
        disabled={busy}
        error={problems.email}
      />
      <Checkbox label="Required signer" checked={isSigner} onChange={setIsSigner} disabled={busy} />
      {isSigner && published && (
        <p className={styles.note}>
          Required signers are part of the published revision. Publish again before requesting
          signatures.
        </p>
      )}
      <Button variant="secondary" type="submit" loading={busy} disabled={busy}>
        Add recipient
      </Button>
    </form>
  );
}
