"use client";

import { useId, type ReactNode } from "react";
import { Button } from "../Button/Button.tsx";
import { useModal } from "../Modal/useModal.ts";
import modal from "../Modal/Modal.module.css";
import styles from "./Dialog.module.css";

type DialogProps = Readonly<{
  open: boolean;
  title: string;
  /** The consequence in a sentence or two, and any field the action needs. */
  children: ReactNode;
  confirmLabel: string;
  /** `danger` makes it an alert dialog with the stop-tone action. */
  tone?: "ink" | "danger" | undefined;
  loading?: boolean | undefined;
  confirmDisabled?: boolean | undefined;
  onConfirm: () => void;
  onClose: () => void;
}>;

/**
 * A confirmation: a title, the consequence, Cancel and the one action. Cancel comes first, so the
 * safe choice holds focus when it opens. Escape and Cancel call `onClose`; the dialog is labelled
 * by its title and described by its body. A task with many fields is a Drawer.
 */
export function Dialog({
  open,
  title,
  children,
  confirmLabel,
  tone = "ink",
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
}: DialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const behaviour = useModal(open, onClose);
  return (
    <dialog
      {...behaviour}
      className={styles.dialog}
      role={tone === "danger" ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <h2 id={titleId} className={modal.title}>
        {title}
      </h2>
      <div id={bodyId} className={styles.body}>
        {children}
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant={tone} loading={loading} disabled={confirmDisabled} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
