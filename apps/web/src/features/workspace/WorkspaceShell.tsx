"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import { useState } from "react";
import { useCommand } from "@/features/command/useCommand.ts";
import { Banner } from "@/ui";
import { CommandNotice } from "./CommandNotice.tsx";
import { StepTracker } from "./StepTracker.tsx";
import type { WorkspaceTab } from "./tabs.ts";
import { usePoll } from "./usePoll.ts";
import { useWorkspaceNav } from "./useWorkspaceNav.ts";
import { WorkspaceActions } from "./WorkspaceActions.tsx";
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
  return (
    <Banner tone="info">
      {voidedAt === null
        ? "This agreement was voided."
        : `This agreement was voided on ${DATE.format(new Date(voidedAt))}.`}
      {voidReason !== null && ` Reason: ${voidReason}`}
    </Banner>
  );
}

/**
 * The workspace both capacities share: header, the progress tracker for staff, the thread beside
 * the document, and staff's drawers. It holds the one `useCommand` for the agreement, so a single
 * command is in flight at a time and the view stays the source of everything shown. It is
 * independent of the app's top bar.
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

  // The completion panel polls a finalizing round itself; the assistant's queue is polled here.
  usePoll(
    !pending && view.aiSuggestions.some((suggestion) => suggestion.status === "queued"),
    refresh,
  );

  function open(next: Panel | null) {
    clearError();
    setPanel(next);
  }

  const notice = (
    <CommandNotice
      error={error}
      onReload={() => void refresh().then(clearError)}
      rateLimited={panel === "assistant" ? ASSISTANT_LIMIT : undefined}
    />
  );

  return (
    <div className={styles.workspace}>
      <WorkspaceHeader
        title={view.agreement.title}
        status={view.agreement.status}
        capacity={capacity}
        orgName={view.orgName}
        actions={
          <WorkspaceActions
            view={view}
            capacity={capacity}
            run={run}
            busy={pending}
            onPanel={open}
            onReveal={reveal}
          />
        }
      />
      {view.agreement.status === "void" && <VoidBanner agreement={view.agreement} />}
      {staff && <StepTracker view={view} />}
      {panel === null && notice}
      <WorkspacePanes
        view={view}
        capacity={capacity}
        run={run}
        busy={pending}
        tab={tab}
        rev={rev}
        onTab={selectTab}
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
