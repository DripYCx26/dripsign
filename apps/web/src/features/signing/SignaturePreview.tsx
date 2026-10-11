import styles from "./SignaturePreview.module.css";

// Past this many characters the name drops one display step so it stays on the 72 px line.
const LONG_NAME = 24;

/**
 * The typed name as it will be signed, in the same face the signed PDF embeds, over a hairline.
 * The name is already in the field beside it, so the drawing is hidden from assistive technology.
 */
export function SignaturePreview({ name }: Readonly<{ name: string }>) {
  return (
    <figure className={styles.preview}>
      <div
        className={styles.ink}
        data-long={name.length > LONG_NAME || undefined}
        aria-hidden="true"
      >
        {name}
      </div>
      <figcaption className={styles.caption}>Signature</figcaption>
    </figure>
  );
}
