import styles from "./Avatar.module.css";

/**
 * Up to two initials from a name: the first character of each of its first two words that start
 * with a letter or digit, upper-cased without a locale so server and browser agree.
 */
export function initials(name: string): string {
  return name
    .split(/\s+/u)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word))
    .slice(0, 2)
    .map((word) => (Array.from(word)[0] ?? "").toUpperCase())
    .join("");
}

/**
 * A person as initials in a circle, never a photo. It always sits beside the person's name, so
 * it is hidden from assistive technology rather than read twice.
 */
export function Avatar({ name }: Readonly<{ name: string }>) {
  return (
    <span className={styles.avatar} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
