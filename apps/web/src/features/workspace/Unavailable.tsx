import { UseAnotherEmail } from "@/features/shell/UseAnotherEmail.tsx";
import { ButtonLink } from "@/ui";
import styles from "./Unavailable.module.css";

/**
 * What a recipient sees for an agreement that is not theirs, or not there: the same words for both,
 * so the page never confirms that an agreement exists.
 */
export function Unavailable({ email }: Readonly<{ email: string }>) {
  return (
    <section className={styles.unavailable}>
      <h1>This agreement isn’t available.</h1>
      <p>{`You’re signed in as ${email}.`}</p>
      <div className={styles.actions}>
        <ButtonLink variant="ink" href="/">
          Back to agreements
        </ButtonLink>
        <UseAnotherEmail />
      </div>
    </section>
  );
}
