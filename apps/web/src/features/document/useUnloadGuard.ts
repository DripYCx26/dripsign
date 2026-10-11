"use client";

import { useEffect } from "react";

/** While `active`, leaving the page (reload, close, address bar) asks the browser to confirm. */
export function useUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      window.removeEventListener("beforeunload", guard);
    };
  }, [active]);
}
