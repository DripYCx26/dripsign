import type { SessionView } from "@dripsign/core/types";
import Link from "next/link";
import type { ReactNode } from "react";
import { Mark, TopBar } from "@/ui";
import { AccountMenu } from "./AccountMenu.tsx";
import styles from "./AppShell.module.css";
import { ShellNav } from "./ShellNav.tsx";
import { hasBothHomes, selectedTenant, type Home } from "./standing.ts";

type AppShellProps = Readonly<{
  session: SessionView;
  home: Home;
  children: ReactNode;
}>;

const STAFF_LINKS = [{ href: "/staff", label: "Agreements" }] as const;
const ADMIN_LINKS = [
  ...STAFF_LINKS,
  { href: "/staff/team", label: "Team" },
  { href: "/staff/settings", label: "Settings" },
] as const;

/**
 * The signed-in page frame: the one banner (brand, navigation, account) and the one `<main>`.
 * Pages inside it render no landmark of their own; the main fills the height left under the bar
 * so a workspace can claim it.
 */
export function AppShell({ session, home, children }: AppShellProps) {
  const tenant = selectedTenant(session);
  const links = tenant?.role === "admin" ? ADMIN_LINKS : STAFF_LINKS;
  const roleLabel =
    home === "staff" ? (tenant === null ? "Staff" : `Staff · ${tenant.name}`) : "Shared with me";
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <TopBar
        brand={
          <Link href={home === "staff" ? "/staff" : "/"} className={styles.brand}>
            <Mark />
          </Link>
        }
        {...(home === "staff" ? { nav: <ShellNav links={links} /> } : {})}
        account={
          <>
            <span className={styles.role}>{roleLabel}</span>
            <AccountMenu
              email={session.email}
              home={home}
              bothHomes={hasBothHomes(session)}
              tenants={session.staffTenants}
              selectedTenantId={tenant?.id ?? null}
            />
          </>
        }
      />
      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
