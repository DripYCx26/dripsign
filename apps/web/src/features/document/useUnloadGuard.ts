"use client";

import { useEffect } from "react";

const LEAVE_PROMPT = "Leave without saving your edits?";

/** Whether an editor is holding unsaved text; at most one draft is edited at a time. */
let unsaved = false;

/** Asks before a programmatic exit (a menu item's router.push) that would drop unsaved edits. */
export function confirmLeave(): boolean {
  return !unsaved || window.confirm(LEAVE_PROMPT);
}

/** Any link click, caught before React and Next see it, so every link on the page is covered. */
function guardLinks(event: MouseEvent): void {
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (link === null || link.getAttribute("target") === "_blank" || link.hasAttribute("download")) {
    return;
  }
  if (confirmLeave()) return;
  event.preventDefault();
  event.stopPropagation();
}

/**
 * While `active`, every way out of the page asks first: the browser's prompt for reload, close
 * and the address bar, a confirm for any link, and `confirmLeave` for the account menu.
 */
export function useUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    unsaved = true;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    window.addEventListener("click", guardLinks, true);
    return () => {
      unsaved = false;
      window.removeEventListener("beforeunload", guard);
      window.removeEventListener("click", guardLinks, true);
    };
  }, [active]);
}
