"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import { DocumentPane } from "@/features/document/DocumentPane.tsx";
import { CompletionPanel } from "@/features/signing/CompletionPanel.tsx";
import { ThreadPane } from "@/features/thread/ThreadPane.tsx";
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
}>;

/**
 * The two regions, each scrolling on its own: the conversation rail with its pinned composer, and
 * the document filling the rest of the width. Under 1024 px `tab` (the header's Chat | Document
 * switch) chooses the one that shows; both stay mounted so a half-edited draft survives a switch.
 */
export function WorkspacePanes({ view, capacity, run, busy, tab, rev }: WorkspacePanesProps) {
  const completed = view.agreement.status === "signed" || view.activeRound?.status === "finalizing";
  return (
    <div className={styles.panes} data-tab={tab}>
      <section className={styles.rail} aria-label="Conversation">
        <ThreadPane view={view} capacity={capacity} run={run} busy={busy} />
      </section>
      <section
        id={DOCUMENT_PANE_ID}
        className={styles.document}
        aria-label="Document"
        tabIndex={-1}
      >
        {completed && <CompletionPanel view={view} capacity={capacity} />}
        <DocumentPane view={view} capacity={capacity} rev={rev} run={run} busy={busy} />
      </section>
    </div>
  );
}
