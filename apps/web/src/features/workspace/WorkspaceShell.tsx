"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import { useState } from "react";
import { useCommand } from "@/features/command/useCommand.ts";
import { Banner } from "@/ui";
import { CommandNotice } from "./CommandNotice.tsx";
import type { WorkspaceTab } from "./tabs.ts";
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
  initialTab: WorkspaceTab;
  rev: number | undefined;
}>;

const ASSISTANT_LIMIT = "Today's assistant limit is reached.";

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function VoidBanner({ agreement }: Readonly<{ agreement: AgreementView["agreement"] }>) {
  const { voidedAt, voidReason } = agreement;
  const parts = [
    voidedAt === null ? "Voided" : `Voided ${DATE.format(new Date(voidedAt))}`,
    ...(voidReason === null ? [] : [voidReason]),
  ];
  return <Banner tone="info">{parts.join(" · ")}</Banner>;
}

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
  const { tab, selectTab, reveal } = useWorkspaceNav(initialTab);
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
        tab={tab}
        onTab={selectTab}
        onPanel={open}
        onReveal={reveal}
      />
      {view.agreement.status === "void" && <VoidBanner agreement={view.agreement} />}
      {panel === null && notice}
      <WorkspacePanes
        view={view}
        capacity={capacity}
        run={run}
        busy={pending}
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
