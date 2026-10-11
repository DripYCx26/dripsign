import { UseAnotherEmail } from "@/features/shell/UseAnotherEmail.tsx";
import styles from "./Unavailable.module.css";

/**
 * What a recipient sees for an agreement that is not theirs, or not there: the same words for both,
 * so the page never confirms that an agreement exists.
 */
export function Unavailable({ email }: Readonly<{ email: string }>) {
  return (
    <section className={styles.unavailable}>
      <h1>{`This agreement isn’t available to ${email}.`}</h1>
      <p>Check that you’re signed in with the address it was sent to.</p>
      <div>
        <UseAnotherEmail />
      </div>
    </section>
  );
}
