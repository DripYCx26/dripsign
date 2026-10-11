"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./ShellNav.module.css";

type NavLink = Readonly<{ href: string; label: string }>;

/** The link whose path is the longest prefix of the current one is the current page. */
function currentHref(links: readonly NavLink[], pathname: string): string | undefined {
  return links
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

/** The staff places in a row, with the current one marked for assistive technology. */
export function ShellNav({ links }: Readonly<{ links: readonly NavLink[] }>) {
  const pathname = usePathname();
  const current = currentHref(links, pathname);
  return (
    <ul className={styles.list}>
      {links.map((link) => (
        <li key={link.href}>
          <Link
            href={link.href}
            className={styles.link}
            aria-current={link.href === current ? "page" : undefined}
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
