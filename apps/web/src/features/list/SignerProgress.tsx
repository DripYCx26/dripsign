import styles from "./SignerProgress.module.css";

export interface SignerProgressModel {
  readonly signed: number;
  readonly required: number;
  readonly finalizing: boolean;
  readonly delayed: boolean;
}

/**
 * How far a signature request has got: "1 of 2 signed", or, once the last signature is in, that
 * the signed files are being prepared.
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
    <span className={styles.progress}>{`${String(signed)} of ${String(required)} signed`}</span>
  );
}
