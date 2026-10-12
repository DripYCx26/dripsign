"use client";

import type { ReactNode } from "react";
import styles from "./FieldJump.module.css";
import { scrollToField } from "./scrollToField.ts";

/** A line of text that scrolls the PDF to that signer's first field marker. */
export function FieldJump({
  recipientId,
  children,
}: Readonly<{ recipientId: string; children: ReactNode }>) {
  return (
    <button
      type="button"
      className={styles.jump}
      onClick={() => {
        scrollToField(document.querySelector(`[data-recipient="${recipientId}"]`));
      }}
    >
      {children}
    </button>
  );
}
