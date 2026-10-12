"use client";

import { useEffect } from "react";

const LEAVE_PROMPT = "Leave without saving your edits?";

/** Whether an editor is holding unsaved text; at most one draft is edited at a time. */
let unsaved = false;

/** Asks before a client-side exit (a link, a menu item) that would drop unsaved edits. */
export function confirmLeave(): boolean {
  return !unsaved || window.confirm(LEAVE_PROMPT);
}

/** A `Link`'s `onNavigate`: cancels the navigation unless the user agrees to lose their edits. */
export function guardNavigation(event: { preventDefault: () => void }): void {
  if (!confirmLeave()) event.preventDefault();
}

/**
 * While `active`, every way out of the page asks first: the browser's prompt for reload, close
 * and the address bar, and `confirmLeave` for the app's own links and menu.
 */
export function useUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    unsaved = true;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      unsaved = false;
      window.removeEventListener("beforeunload", guard);
    };
  }, [active]);
}
