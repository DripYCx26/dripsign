"use client";

import { useEffect } from "react";

const LEAVE_PROMPT = "Leave without saving your edits?";
const SENTINEL = "__dripsignUnsavedGuard";

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
 * and the address bar, a confirm for any link, `confirmLeave` for the account menu, and for
 * browser Back. Back works through a sentinel entry on top of the editor's own: Back pops onto
 * the editor's entry (same URL, same tree, so nothing remounts) and, if declined, the sentinel
 * is pushed again. Our capture listener swallows that popstate so Next never traverses.
 */
export function useUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    unsaved = true;
    const href = window.location.href;
    const state = window.history.state as object | null;
    const pushSentinel = () => {
      window.history.pushState({ ...state, [SENTINEL]: true }, "", href);
    };
    // The guard's own step back passes unasked; the rest stays armed in case there is nowhere to go.
    let approved = false;
    const guardBack = (event: PopStateEvent) => {
      if (approved) {
        approved = false;
        return;
      }
      if (confirmLeave()) {
        // Next handles this popstate; from the editor's own entry we still need one more step.
        if (window.location.href === href) {
          approved = true;
          window.history.back();
        }
        return;
      }
      event.stopImmediatePropagation();
      pushSentinel();
    };
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    pushSentinel();
    window.addEventListener("popstate", guardBack, true);
    window.addEventListener("beforeunload", guard);
    window.addEventListener("click", guardLinks, true);
    return () => {
      unsaved = false;
      window.removeEventListener("popstate", guardBack, true);
      window.removeEventListener("beforeunload", guard);
      window.removeEventListener("click", guardLinks, true);
      // Dropping the sentinel after a save or discard; a link that already left owns the history.
      const current = window.history.state as Record<string, unknown> | null;
      if (current?.[SENTINEL] === true) window.history.back();
    };
  }, [active]);
}
