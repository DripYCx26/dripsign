import styles from "./SignerProgress.module.css";

export interface SignerProgressModel {
  readonly signed: number;
  readonly required: number;
  readonly finalizing: boolean;
  readonly delayed: boolean;
}

/**
 * How far a signature request has got: "1 of 2 signed" with a dot per required signer, or, once
 * the last signature is in, that the signed files are being prepared. The dots are decoration;
 * the words carry the meaning.
 */
export function SignerProgress({ signed, required, finalizing, delayed }: SignerProgressModel) {
  if (finalizing) {
    return (
      <span className={styles.progress}>
        {delayed ? "Preparing signed files (delayed)" : "Preparing signed files"}
      </span>
    );
  }
  return (
    <span className={styles.progress}>
      <span className={styles.dots} aria-hidden="true">
        {Array.from({ length: required }, (_, index) => (
          // The dots are positional and never reorder.
          <span key={index} className={styles.dot} data-filled={index < signed} />
        ))}
      </span>
      {`${String(signed)} of ${String(required)} signed`}
    </span>
  );
}
