import Link from "next/link";
import { devIdentityLabel, devLoginEnabled } from "@/features/dev/identities.ts";
import { getSession } from "@/server/session.ts";
import styles from "./DevBanner.module.css";
import { standingWord } from "./standing.ts";

/**
 * The strip on every page while development sign-in is on, so no one mistakes a local identity
 * for a verified one. Renders nothing when the flag is off.
 */
export async function DevBanner() {
  if (!(await devLoginEnabled())) return null;
  const session = await getSession();
  const name = session === null ? null : await devIdentityLabel(session.email);
  return (
    <div className={styles.banner}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.full}>Development sign-in is on</span>
      <span className={styles.short}>Dev</span>
      <span className={styles.who}>
        {session === null || name === null ? (
          "Not signed in"
        ) : (
          <>
            <span className={styles.full}>Signed in as </span>
            {name}
            <span className={styles.full}> ({standingWord(session)})</span>
          </>
        )}
      </span>
      {session !== null && (
        <Link href="/dev/sign-in" className={styles.switch}>
          <span className={styles.full}>Switch identity</span>
          <span className={styles.short}>Switch</span>
        </Link>
      )}
    </div>
  );
}
