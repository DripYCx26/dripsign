export type NavLink = Readonly<{ href: string; label: string }>;

/** The link whose path is the longest prefix of the current one is the current page. */
export function currentHref(links: readonly NavLink[], pathname: string): string | undefined {
  return links
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
