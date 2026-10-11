"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import { DocumentPane } from "@/features/document/DocumentPane.tsx";
import { ActivityTimeline } from "@/features/manage/ActivityTimeline.tsx";
import { CompletionPanel } from "@/features/signing/CompletionPanel.tsx";
import { ThreadPane } from "@/features/thread/ThreadPane.tsx";
import { Segmented } from "@/ui";
import type { RunCommand } from "./commands.ts";
import { DOCUMENT_PANE_ID } from "./nextStep.ts";
import type { WorkspaceTab } from "./tabs.ts";
import styles from "./WorkspacePanes.module.css";

type WorkspacePanesProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
  run: RunCommand;
  busy: boolean;
  tab: WorkspaceTab;
  rev: number | undefined;
  onTab: (tab: WorkspaceTab) => void;
}>;

/**
 * The two columns: the conversation (thread or activity) at 400 px, the document beside it up to
 * 880 px. Below 1024 px one shows at a time, chosen by the "Thread | Document" switch; the
 * "Thread | Activity" switch always chooses what the conversation column holds.
 */
export function WorkspacePanes({
  view,
  capacity,
  run,
  busy,
  tab,
  rev,
  onTab,
}: WorkspacePanesProps) {
  const completed = view.agreement.status === "signed" || view.activeRound?.status === "finalizing";
  return (
    <div className={styles.panes} data-tab={tab}>
      <div className={styles.toggle}>
        <Segmented
          label="Show"
          hideLabel
          name="workspace-pane"
          options={[
            { value: "thread", label: "Thread" },
            { value: "document", label: "Document" },
          ]}
          value={tab === "document" ? "document" : "thread"}
          onChange={onTab}
        />
      </div>
      <section className={styles.conversation} aria-label="Conversation">
        <Segmented
          label="Conversation view"
          hideLabel
          name="workspace-side"
          options={[
            { value: "thread", label: "Thread" },
            { value: "activity", label: "Activity" },
          ]}
          value={tab === "activity" ? "activity" : "thread"}
          onChange={onTab}
        />
        {tab === "activity" ? (
          <ActivityTimeline view={view} />
        ) : (
          <ThreadPane view={view} capacity={capacity} run={run} busy={busy} />
        )}
      </section>
      <section
        id={DOCUMENT_PANE_ID}
        className={styles.document}
        aria-label="Document"
        tabIndex={-1}
      >
        {completed && <CompletionPanel view={view} capacity={capacity} />}
        <DocumentPane view={view} capacity={capacity} rev={rev} />
      </section>
    </div>
  );
}
