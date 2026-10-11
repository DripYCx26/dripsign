"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import { Pill, Segmented } from "@/ui";
import { BackButton } from "./BackButton.tsx";
import type { RunCommand } from "./commands.ts";
import styles from "./WorkspaceHeader.module.css";
import { nextStep } from "./nextStep.ts";
import { pillStatus } from "./status.ts";
import type { RailMode, WorkspaceTab } from "./tabs.ts";
import { WorkspaceMenu, WorkspacePrimary } from "./WorkspaceActions.tsx";
import type { Panel } from "./WorkspacePanels.tsx";

type WorkspaceHeaderProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
  run: RunCommand;
  busy: boolean;
  rail: RailMode;
  tab: WorkspaceTab;
  onTab: (tab: WorkspaceTab) => void;
  onPanel: (panel: Panel) => void;
  onReveal: (href: string) => void;
}>;

const HOME = { staff: "/staff", recipient: "/" } as const;

const TABS = [
  { value: "chat", label: "Chat" },
  { value: "document", label: "Document" },
] as const;

/**
 * The workspace head, one 56 px row: back, the title in the display face with its status, the
 * step's chip, then the primary action and menu. Under 1024 px the chip, the Chat | Document
 * switch (only when there is a rail to switch to) and the primary action share a second row, and
 * there is none when they are all absent. Each control is rendered once and placed by CSS.
 */
export function WorkspaceHeader({
  view,
  capacity,
  run,
  busy,
  rail,
  tab,
  onTab,
  onPanel,
  onReveal,
}: WorkspaceHeaderProps) {
  const { title, status } = view.agreement;
  const step = nextStep(capacity, view);
  const secondRow = rail !== "none" || step.label !== "" || step.chip !== undefined;
  return (
    <header className={styles.header} data-second-row={secondRow ? "" : undefined}>
      <div className={styles.back}>
        <BackButton label="Back to agreements" href={HOME[capacity]} />
      </div>
      <div className={styles.title}>
        <h1>{title}</h1>
        <Pill status={pillStatus(status)} />
        {capacity === "recipient" && <p className={styles.from}>{`From ${view.orgName}`}</p>}
      </div>
      {step.chip !== undefined && (
        <div className={styles.chip}>
          <Pill tone="info">{step.chip}</Pill>
        </div>
      )}
      {rail !== "none" && (
        <div className={styles.toggle}>
          <Segmented
            label="Show"
            hideLabel
            size="sm"
            name="workspace-pane"
            options={TABS}
            value={tab}
            onChange={onTab}
          />
        </div>
      )}
      <div className={styles.primary}>
        <WorkspacePrimary step={step} run={run} busy={busy} onPanel={onPanel} onReveal={onReveal} />
      </div>
      <div className={styles.menu}>
        <WorkspaceMenu view={view} capacity={capacity} onPanel={onPanel} />
      </div>
    </header>
  );
}
