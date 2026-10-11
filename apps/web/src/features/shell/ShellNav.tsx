"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { currentHref, type NavLink } from "./navLinks.ts";
import styles from "./ShellNav.module.css";

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
