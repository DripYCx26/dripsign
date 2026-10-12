import type { SignatureFace } from "@dripsign/core/pdf/font";
import styles from "./SignaturePreview.module.css";

// Past this many characters the name drops one display step so it stays on one line longer.
const LONG_NAME = 24;

type SignaturePreviewProps = Readonly<{
  name: string;
  /** The face the server's name check chose: Newsreader Italic, or the plain fallback. */
  face: SignatureFace;
}>;

/**
 * The typed name as it will be signed, in the face the signed PDF draws it in, over a drawn rule.
 * The name is already in the field above, so the drawing is hidden from assistive technology.
 */
export function SignaturePreview({ name, face }: SignaturePreviewProps) {
  return (
    <figure className={styles.preview}>
      <div
        className={styles.ink}
        data-face={face}
        data-long={name.length > LONG_NAME || undefined}
        aria-hidden="true"
      >
        {name}
      </div>
      <figcaption className={styles.caption}>Signature · as it will appear in the PDF</figcaption>
    </figure>
  );
}
