import type { ReactNode } from "react";
import styles from "./TopBar.module.css";

type TopBarProps = Readonly<{
  /** The product mark, usually a link home. */
  brand: ReactNode;
  /** The places in a row; wrapped in a labelled `<nav>`. */
  nav?: ReactNode;
  navLabel?: string | undefined;
  /** The signed-in person's account menu. */
  account?: ReactNode;
}>;

/**
 * The page's one banner: brand, navigation, account. 56 px high; below 640 the navigation is
 * hidden and the account menu carries its places, so the bar stays one row.
 */
export function TopBar({ brand, nav, navLabel = "Primary", account }: TopBarProps) {
  return (
    <header className={styles.bar}>
      <div className={styles.brand}>{brand}</div>
      {nav !== undefined && (
        <nav className={styles.nav} aria-label={navLabel}>
          {nav}
        </nav>
      )}
      {account !== undefined && <div className={styles.account}>{account}</div>}
    </header>
  );
}
