"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import { DocumentPane } from "@/features/document/DocumentPane.tsx";
import type { DocumentState } from "@/features/document/useDocumentState.ts";
import { CompletionPanel } from "@/features/signing/CompletionPanel.tsx";
import { ThreadPane } from "@/features/thread/ThreadPane.tsx";
import type { RunCommand } from "./commands.ts";
import { DOCUMENT_PANE_ID } from "./nextStep.ts";
import type { RailMode, WorkspaceTab } from "./tabs.ts";
import styles from "./WorkspacePanes.module.css";

type WorkspacePanesProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
  run: RunCommand;
  busy: boolean;
  rail: RailMode;
  tab: WorkspaceTab;
  doc: DocumentState;
}>;

/**
 * The two regions, each scrolling on its own: the conversation rail with its pinned composer, and
 * the document filling the rest of the width. The rail is full, narrow (history only) or absent
 * (`railMode`). Under 1024 px `tab` (the header's Chat | Document switch) chooses the one that
 * shows; both stay mounted so a half-edited draft survives a switch.
 */
export function WorkspacePanes({ view, capacity, run, busy, rail, tab, doc }: WorkspacePanesProps) {
  return (
    <div className={styles.panes} data-tab={tab} data-rail={rail}>
      {rail !== "none" && (
        <section className={styles.rail} aria-label="Conversation">
          <ThreadPane view={view} capacity={capacity} run={run} busy={busy} />
        </section>
      )}
      <section
        id={DOCUMENT_PANE_ID}
        className={styles.document}
        aria-label="Document"
        tabIndex={-1}
      >
        <CompletionPanel view={view} />
        <DocumentPane view={view} capacity={capacity} run={run} busy={busy} doc={doc} />
      </section>
    </div>
  );
}
