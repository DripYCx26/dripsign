"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import { AssistantThread } from "@/features/draft/AssistantThread.tsx";
import { DocumentPane } from "@/features/document/DocumentPane.tsx";
import type { DocumentState } from "@/features/document/useDocumentState.ts";
import { CompletionPanel } from "@/features/signing/CompletionPanel.tsx";
import { ThreadPane } from "@/features/thread/ThreadPane.tsx";
import type { RunCommand } from "./commands.ts";
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
 * The two regions, each scrolling on its own: the rail with its pinned composer, and the document
 * filling the rest of the width. The rail is the thread (full, or narrow when it is history only),
 * the assistant while the agreement is a draft, or absent (`railMode`). Under 1024 px `tab` (the header's Chat | Document switch) chooses the one that
 * shows; both stay mounted so a half-edited draft survives a switch.
 */
export function WorkspacePanes({ view, capacity, run, busy, rail, tab, doc }: WorkspacePanesProps) {
  return (
    <div className={styles.panes} data-tab={tab} data-rail={rail}>
      {rail === "draft" && (
        <section className={styles.rail} aria-label="Assistant">
          <AssistantThread view={view} run={run} busy={busy} preview={doc.preview} />
        </section>
      )}
      {(rail === "full" || rail === "narrow") && (
        <section className={styles.rail} aria-label="Conversation">
          <ThreadPane view={view} capacity={capacity} run={run} busy={busy} />
        </section>
      )}
      <section className={styles.document} aria-label="Document">
        <CompletionPanel view={view} />
        <DocumentPane view={view} capacity={capacity} run={run} busy={busy} doc={doc} />
      </section>
    </div>
  );
}
