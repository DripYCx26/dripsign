import Link from "next/link";
import { Moment } from "@/ui";
import styles from "./AgreementRow.module.css";
import type { RowModel } from "./rows.ts";
import { SignerProgress } from "./SignerProgress.tsx";
import { StatusPill } from "./StatusPill.tsx";

/**
 * One agreement as a 64 px row, a single link: title and who it is with, what happens next (and
 * signature progress), the status, and when it last changed.
 */
export function AgreementRow({ row }: Readonly<{ row: RowModel }>) {
  return (
    <li>
      <Link href={row.href} className={styles.row}>
        <span className={styles.main}>
          <span className={styles.title}>{row.title}</span>
          <span className={styles.subline}>{row.subline}</span>
        </span>
        <span className={styles.next}>
          {row.phrase !== "" && <span className={styles.phrase}>{row.phrase}</span>}
          {row.progress !== null && <SignerProgress {...row.progress} />}
        </span>
        <span className={styles.status}>
          <StatusPill status={row.status} />
          <span className={styles.updated}>
            <Moment value={row.updatedAt} format="relative" />
          </span>
        </span>
      </Link>
    </li>
  );
}
