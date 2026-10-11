"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import { useState } from "react";
import { useCommand } from "@/features/command/useCommand.ts";
import { CommandNotice } from "./CommandNotice.tsx";
import { defaultTab, railMode, type WorkspaceTab } from "./tabs.ts";
import { usePoll } from "./usePoll.ts";
import { useWorkspaceNav } from "./useWorkspaceNav.ts";
import { WorkspaceHeader } from "./WorkspaceHeader.tsx";
import { WorkspacePanels, type Panel } from "./WorkspacePanels.tsx";
import { WorkspacePanes } from "./WorkspacePanes.tsx";
import styles from "./WorkspaceShell.module.css";

type WorkspaceShellProps = Readonly<{
  agreementId: string;
  capacity: Capacity;
  initialView: AgreementView;
  initialTab: WorkspaceTab | undefined;
  rev: number | undefined;
}>;

const ASSISTANT_LIMIT = "Today's assistant limit is reached.";

/**
 * The workspace both capacities share: the header, the thread rail beside the document, and
 * staff's drawers. It holds the one `useCommand` for the agreement, so a single command is in
 * flight at a time and the view stays the source of everything shown, and the one poll that keeps
 * the view moving while the worker prepares a PDF or answers the assistant.
 */
export function WorkspaceShell({
  agreementId,
  capacity,
  initialView,
  initialTab,
  rev,
}: WorkspaceShellProps) {
  const { view, run, pending, error, clearError, refresh } = useCommand(
    agreementId,
    capacity,
    initialView,
  );
  const nav = useWorkspaceNav(initialTab ?? defaultTab(initialView));
  const rail = railMode(view);
  // Without a rail there is only the document, whatever tab the address or a proposal asked for.
  const tab = rail === "none" ? "document" : nav.tab;
  const [panel, setPanel] = useState<Panel | null>(null);
  const staff = capacity === "staff";

  // The completion panel polls a finalizing round itself; the worker's other two jobs are here.
  const waitingOnWorker =
    view.agreement.preparation?.status === "preparing" ||
    view.aiSuggestions.some((suggestion) => suggestion.status === "queued");
  usePoll(!pending && waitingOnWorker, refresh);

  function open(next: Panel | null) {
    clearError();
    setPanel(next);
  }

  const notice = (
    <CommandNotice
      error={error}
      placement={panel === null ? "page" : "panel"}
      onReload={() => void refresh().then(clearError)}
      rateLimited={panel === "assistant" ? ASSISTANT_LIMIT : undefined}
    />
  );

  return (
    <div className={styles.workspace} data-workspace>
      <WorkspaceHeader
        view={view}
        capacity={capacity}
        run={run}
        busy={pending}
        rail={rail}
        tab={tab}
        onTab={nav.selectTab}
        onPanel={open}
        onReveal={nav.reveal}
      />
      {panel === null && notice}
      <WorkspacePanes
        view={view}
        capacity={capacity}
        run={run}
        busy={pending}
        rail={rail}
        tab={tab}
        rev={rev}
      />
      {staff && (
        <WorkspacePanels
          view={view}
          run={run}
          busy={pending}
          open={panel}
          notice={notice}
          onClose={() => {
            open(null);
          }}
        />
      )}
    </div>
  );
}
