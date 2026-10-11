"use client";

import { useState, type ReactNode } from "react";
import { Segmented } from "@/ui";
import styles from "./ViewToggle.module.css";

type View = "reading" | "pdf";

const OPTIONS = [
  { value: "reading", label: "Reading view" },
  { value: "pdf", label: "PDF" },
] as const;

/**
 * Reading view or the exact PDF. The PDF is built only once it is first chosen, then kept so
 * switching back and forth does not load it again.
 */
export function ViewToggle({ reading, pdf }: Readonly<{ reading: ReactNode; pdf: ReactNode }>) {
  const [view, setView] = useState<View>("reading");
  const [pdfOpened, setPdfOpened] = useState(false);
  return (
    <div className={styles.toggle}>
      <Segmented
        label="Document view"
        hideLabel
        name="document-view"
        options={OPTIONS}
        value={view}
        onChange={(next) => {
          setView(next);
          if (next === "pdf") setPdfOpened(true);
        }}
      />
      <div hidden={view !== "reading"}>{reading}</div>
      {pdfOpened && <div hidden={view !== "pdf"}>{pdf}</div>}
    </div>
  );
}
