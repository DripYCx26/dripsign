import type { AgreementStatus, Capacity } from "@dripsign/core/types";
import Link from "next/link";
import type { ReactNode } from "react";
import { Pill } from "@/ui";
import styles from "./WorkspaceHeader.module.css";
import { pillStatus } from "./status.ts";

type WorkspaceHeaderProps = Readonly<{
  title: string;
  status: AgreementStatus;
  capacity: Capacity;
  /** The organisation the agreement comes from, shown to recipients. */
  orgName: string;
  /** The primary action and the overflow menu. */
  actions: ReactNode;
}>;

const HOME = {
  staff: { href: "/staff", label: "Agreements" },
  recipient: { href: "/", label: "Your agreements" },
} as const;

/**
 * The workspace head: breadcrumb back to the list, the title in the display face with its status,
 * and the actions. On a phone the actions leave the head and sit in a bottom bar, in CSS, so the
 * same controls (and their dialogs) are rendered once.
 */
export function WorkspaceHeader({
  title,
  status,
  capacity,
  orgName,
  actions,
}: WorkspaceHeaderProps) {
  const home = HOME[capacity];
  return (
    <header className={styles.header}>
      <nav aria-label="Breadcrumb">
        <ol className={styles.crumbs}>
          <li>
            <Link href={home.href}>{home.label}</Link>
          </li>
        </ol>
      </nav>
      <div className={styles.line}>
        <div className={styles.title}>
          <h1>{title}</h1>
          <Pill status={pillStatus(status)} />
          {capacity === "recipient" && <p className={styles.from}>{`From ${orgName}`}</p>}
        </div>
        <div className={styles.actions}>{actions}</div>
      </div>
    </header>
  );
}
