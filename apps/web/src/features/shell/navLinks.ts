import type { SessionView } from "@dripsign/core/types";
import { selectedTenant, type Home } from "./standing.ts";

export type NavLink = Readonly<{ href: string; label: string }>;

const STAFF_LINKS = [{ href: "/staff", label: "Agreements" }] as const;
const ADMIN_LINKS = [...STAFF_LINKS, { href: "/staff/team", label: "Team" }] as const;

/** The places in the bar: staff get the agreements, admins the team too; recipients have none. */
export function navLinksFor(session: SessionView, home: Home): readonly NavLink[] {
  if (home !== "staff") return [];
  return selectedTenant(session)?.role === "admin" ? ADMIN_LINKS : STAFF_LINKS;
}

/** The link whose path is the longest prefix of the current one is the current page. */
export function currentHref(links: readonly NavLink[], pathname: string): string | undefined {
  return links
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
