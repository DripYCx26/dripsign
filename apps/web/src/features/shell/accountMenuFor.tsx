import type { SessionView } from "@dripsign/core/types";
import type { ReactNode } from "react";
import { AccountMenu } from "./AccountMenu.tsx";
import { navLinksFor } from "./navLinks.ts";
import { hasBothHomes, selectedTenant, type Home } from "./standing.ts";
import { readTheme } from "./theme.ts";

/**
 * The account menu wired from the session, so the app bar and a workspace's own bar share one
 * wiring. A server function: AccountMenu is a client component and cannot be called from one.
 */
export function accountMenuFor(session: SessionView, home: Home): ReactNode {
  return <ThemedAccountMenu session={session} home={home} />;
}

/** Reads the saved theme where the menu is drawn, so callers stay synchronous. */
async function ThemedAccountMenu({
  session,
  home,
}: Readonly<{ session: SessionView; home: Home }>) {
  const tenant = selectedTenant(session);
  const roleLabel =
    home === "staff" ? (tenant === null ? "Staff" : `Staff · ${tenant.name}`) : "Shared with me";
  return (
    <AccountMenu
      email={session.email}
      roleLabel={roleLabel}
      home={home}
      bothHomes={hasBothHomes(session)}
      links={navLinksFor(session, home)}
      tenants={session.staffTenants}
      selectedTenantId={tenant?.id ?? null}
      theme={(await readTheme()) ?? "system"}
    />
  );
}
