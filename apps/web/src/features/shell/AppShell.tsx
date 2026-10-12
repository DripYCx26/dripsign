import type { SessionView } from "@dripsign/core/types";
import Link from "next/link";
import type { ReactNode } from "react";
import { Mark, TopBar } from "@/ui";
import { accountMenuFor } from "./accountMenuFor.tsx";
import styles from "./AppShell.module.css";
import { navLinksFor } from "./navLinks.ts";
import { ShellNav } from "./ShellNav.tsx";
import type { Home } from "./standing.ts";

type AppShellProps = Readonly<{
  session: SessionView;
  home: Home;
  /** `false` when the page draws its own bar (a workspace), so the shell adds none. */
  bar?: false | undefined;
  children: ReactNode;
}>;

/**
 * The signed-in page frame: the one banner (brand, navigation, account) and the one `<main>`.
 * Pages inside it render no landmark of their own; the main fills the height left under the bar
 * so a workspace can claim it.
 */
export function AppShell({ session, home, bar, children }: AppShellProps) {
  const links = navLinksFor(session, home);
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      {bar !== false && (
        <TopBar
          brand={
            <Link href={home === "staff" ? "/staff" : "/"} className={styles.brand}>
              <Mark />
            </Link>
          }
          {...(links.length > 0 ? { nav: <ShellNav links={links} /> } : {})}
          account={accountMenuFor(session, home)}
        />
      )}
      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
