"use client";

import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";
import { addStaff } from "@/server/actions/staff.ts";
import { Button, Notice, Select, TextField } from "@/ui";
import { formText } from "./formText.ts";
import { settle } from "./settle.ts";
import styles from "./TeamRoster.module.css";

const ROLES = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
] as const;

/** Adds one person to the workspace; the roster refreshes on success. */
export function AddStaffForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function add(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = formText(data, "name");
    setPending(true);
    setProblem(null);
    const result = await settle(
      addStaff({
        email: formText(data, "email"),
        role: formText(data, "role") === "admin" ? "admin" : "member",
        ...(name === "" ? {} : { name }),
      }),
    );
    setPending(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    form.reset();
    router.refresh();
  }

  return (
    <form className={styles.add} onSubmit={(event) => void add(event)}>
      <h2>Add a person</h2>
      {problem !== null && (
        <Notice tone="stop" live="alert">
          {problem}
        </Notice>
      )}
      <TextField label="Email" name="email" type="email" autoComplete="off" required />
      <TextField label="Name (optional)" name="name" autoComplete="off" />
      <Select label="Role" name="role" options={ROLES} defaultValue="member" />
      <Button type="submit" variant="ink" loading={pending}>
        Add person
      </Button>
    </form>
  );
}
