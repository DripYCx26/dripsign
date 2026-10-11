"use client";

import { useId, type ReactNode } from "react";
import { Button } from "../Button/Button.tsx";
import { useModal } from "../Modal/useModal.ts";
import modal from "../Modal/Modal.module.css";
import styles from "./Drawer.module.css";

type DrawerProps = Readonly<{
  open: boolean;
  title: string;
  /** 440 for a list or a form, 640 for a working surface; both give way to the screen's width. */
  width?: 440 | 640 | undefined;
  onClose: () => void;
  children: ReactNode;
}>;

/**
 * A modal panel from the inline end, full height: recipients, the private assistant. Its contents
 * stay mounted while closed, so a half-typed field survives a close and reopen. Escape and Close
 * call `onClose`; modal behaviour is `useModal`.
 */
export function Drawer({ open, title, width = 440, onClose, children }: DrawerProps) {
  const titleId = useId();
  const behaviour = useModal(open, onClose);
  return (
    <dialog {...behaviour} className={styles.drawer} data-width={width} aria-labelledby={titleId}>
      <div className={modal.head}>
        <h2 id={titleId} className={modal.title}>
          {title}
        </h2>
        <Button variant="quiet" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className={styles.body}>{children}</div>
    </dialog>
  );
}
