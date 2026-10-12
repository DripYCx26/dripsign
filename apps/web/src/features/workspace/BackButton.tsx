import Link from "next/link";
import { guardNavigation } from "@/features/document/useUnloadGuard.ts";
import { ChevronLeft } from "@/ui";
import styles from "./BackButton.module.css";

type BackButtonProps = Readonly<{
  /** Where it goes and what it says ("Back to agreements"); the glyph alone names nothing. */
  label: string;
  href: string;
}>;

/** The chevron that leaves a workspace, the publish review or the signing flow for its parent. */
export function BackButton({ label, href }: BackButtonProps) {
  return (
    <Link href={href} className={styles.back} aria-label={label} onNavigate={guardNavigation}>
      <ChevronLeft aria-hidden="true" />
    </Link>
  );
}
