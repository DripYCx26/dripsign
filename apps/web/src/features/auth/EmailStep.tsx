import type { SubmitEvent } from "react";
import { Button, TextField } from "@/ui";
import styles from "./SignInFlow.module.css";

type EmailStepProps = Readonly<{
  pending: boolean;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
}>;

/** The first sign-in question: which address should the code go to. */
export function EmailStep({ pending, onSubmit }: EmailStepProps) {
  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <TextField
        label="Email"
        name="email"
        type="email"
        size="lg"
        autoComplete="email"
        required
        autoFocus
      />
      <Button type="submit" variant="ink" size="lg" loading={pending}>
        Send code
      </Button>
    </form>
  );
}
