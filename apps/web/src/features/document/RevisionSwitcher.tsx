"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/ui";
import styles from "./RevisionSwitcher.module.css";

export interface RevisionOption {
  readonly value: string;
  readonly label: string;
}

type RevisionSwitcherProps = Readonly<{
  options: readonly RevisionOption[];
  value: string;
  /** The option shown when the URL has no `rev`; choosing it clears the parameter. */
  defaultValue: string;
}>;

/**
 * Which revision the pane shows, held in `?rev=` so a view can be linked and survives a reload.
 * With one option there is nothing to choose, so the label stands alone.
 */
export function RevisionSwitcher({ options, value, defaultValue }: RevisionSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const only = options.length === 1 ? options[0] : undefined;
  if (only !== undefined) return <p className={styles.only}>{only.label}</p>;

  function choose(next: string) {
    const params = new URLSearchParams(search.toString());
    if (next === defaultValue) params.delete("rev");
    else params.set("rev", next);
    const query = params.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
  }

  return (
    <div className={styles.switcher}>
      <Select label="Revision" name="rev" options={options} value={value} onChange={choose} />
    </div>
  );
}
