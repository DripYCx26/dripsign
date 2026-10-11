import { useState } from "react";
import { DOCUMENT_PANE_ID, PENDING_PROPOSAL_ID } from "./nextStep.ts";
import type { WorkspaceTab } from "./tabs.ts";

/** Keeps `?tab=` in the address without a navigation, so a reload or a shared link lands here. */
function writeTab(tab: WorkspaceTab): void {
  const url = new URL(window.location.href);
  if (tab === "thread") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history.replaceState(window.history.state, "", url);
}

/**
 * Which tab the workspace shows and how a `scroll` step reaches its target: it first switches to
 * the tab that holds the element (on a phone the other pane is not rendered), then scrolls to it
 * and moves focus there.
 */
export function useWorkspaceNav(initialTab: WorkspaceTab) {
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);

  function selectTab(next: WorkspaceTab) {
    setTab(next);
    writeTab(next);
  }

  function reveal(href: string) {
    const id = href.slice(1);
    selectTab(id === DOCUMENT_PANE_ID ? "document" : "thread");
    window.requestAnimationFrame(() => {
      const target = document.getElementById(id);
      target?.scrollIntoView({ block: id === PENDING_PROPOSAL_ID ? "center" : "start" });
      target?.focus({ preventScroll: true });
    });
  }

  return { tab, selectTab, reveal };
}
