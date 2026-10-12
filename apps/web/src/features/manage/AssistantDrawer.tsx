"use client";

import { AssistantThread } from "@/features/draft/AssistantThread.tsx";
import { Drawer } from "@/ui";
import type { PanelProps } from "./panel.ts";

/**
 * The private assistant while negotiating: the same chat as the drafting rail, in a drawer. Staff
 * ask, the assistant plans and drafts, and nothing changes until a draft is applied.
 */
export function AssistantDrawer({ open, view, run, busy, notice, onClose }: PanelProps) {
  return (
    <Drawer open={open} title="Private assistant" width={640} onClose={onClose}>
      <AssistantThread view={view} run={run} busy={busy} notice={notice} />
    </Drawer>
  );
}
