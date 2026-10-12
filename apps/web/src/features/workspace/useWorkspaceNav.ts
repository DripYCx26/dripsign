import { useState } from "react";
import { useProposalIntent } from "../thread/intent.ts";
import type { WorkspaceTab } from "./tabs.ts";

/**
 * Keeps `?tab=` in the address without a navigation, so a reload or a shared link lands here. Both
 * values are written: the default for an address without one depends on the agreement's state.
 */
function writeTab(tab: WorkspaceTab): void {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  window.history.replaceState(window.history.state, "", url);
}

/** Which tab the workspace shows. */
export function useWorkspaceNav(initialTab: WorkspaceTab) {
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const intent = useProposalIntent();

  function selectTab(next: WorkspaceTab) {
    setTab(next);
    writeTab(next);
  }

  // A proposal started from the document lands in the composer, which lives in the chat pane.
  return { tab: intent === null ? tab : "chat", selectTab };
}
