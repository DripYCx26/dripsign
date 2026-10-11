import styles from "./Mark.module.css";

/**
 * The product mark: a drop above a signature line, beside the display-face name. The one owner of
 * how DripSign is signed. The glyph is decoration; the name is the text.
 */
export function Mark() {
  return (
    <span className={styles.mark}>
      <svg className={styles.glyph} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3c2.8 3.4 5 6.2 5 9.2a5 5 0 0 1-10 0C7 9.2 9.2 6.4 12 3Z" />
        <path d="M4 21h16" />
      </svg>
      <span>DripSign</span>
    </span>
  );
}
