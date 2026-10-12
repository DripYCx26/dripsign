"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import type { ReactNode } from "react";
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
  /** The document's revision, view and draft controls; null when there is no document. */
  documentControls: ReactNode;
}>;

const HOME = { staff: "/staff", recipient: "/" } as const;

const TABS = [
  { value: "chat", label: "Chat" },
  { value: "document", label: "Document" },
] as const;

/**
 * The workspace head, one 56 px row: back, the title in the display face with its status, the
 * step's chip and, on a void agreement, why; then the document's controls, the primary action and
 * the menu. Under 1024 px the Chat | Document switch (only when there is a rail to switch to),
 * the document controls and the primary action share a second row, and there is none when they
 * are all absent. Each control is rendered once and placed by CSS.
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
  documentControls,
}: WorkspaceHeaderProps) {
  const { title, status, voidReason } = view.agreement;
  const step = nextStep(capacity, view);
  const secondRow = rail !== "none" || step.label !== "" || documentControls !== null;
  return (
    <header className={styles.header} data-tab={tab} data-second-row={secondRow ? "" : undefined}>
      <div className={styles.back}>
        <BackButton label="Back to agreements" href={HOME[capacity]} />
      </div>
      <div className={styles.title}>
        <h1>{title}</h1>
        <Pill status={pillStatus(status)} />
        {step.chip !== undefined && <Pill tone="info">{step.chip}</Pill>}
        {voidReason !== null && (
          <p className={styles.note} title={voidReason}>
            {voidReason}
          </p>
        )}
        {capacity === "recipient" && <p className={styles.from}>{`From ${view.orgName}`}</p>}
      </div>
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
      {documentControls !== null && <div className={styles.document}>{documentControls}</div>}
      <div className={styles.primary}>
        <WorkspacePrimary step={step} run={run} busy={busy} onPanel={onPanel} onReveal={onReveal} />
      </div>
      <div className={styles.menu}>
        <WorkspaceMenu view={view} capacity={capacity} onPanel={onPanel} />
      </div>
    </header>
  );
}
