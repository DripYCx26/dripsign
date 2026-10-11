import { useEffect, useRef, type SyntheticEvent } from "react";

/**
 * Holds a native `<dialog>` open as a modal while `open` is true: `showModal` makes the rest of
 * the page inert (the focus trap) and moves focus into the dialog; Escape asks `onClose` instead
 * of closing behind React's back (the owner may refuse, as while a command is in flight); closing
 * returns focus to whatever held it before. The one owner of modal behaviour; Dialog and Drawer
 * spread its result onto their `<dialog>`.
 */
export function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || dialog === null) return;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open]);
  return {
    ref,
    onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      onClose();
    },
    // A browser may still close the dialog itself; keep the owner in step. The close this effect
    // makes in cleanup arrives after `open` is already false, so it is no one's to answer.
    onClose: (event: SyntheticEvent<HTMLDialogElement>) => {
      if (open && !event.currentTarget.open) onClose();
    },
  };
}
