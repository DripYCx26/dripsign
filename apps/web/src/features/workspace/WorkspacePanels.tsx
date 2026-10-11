"use client";

import type { AgreementView } from "@dripsign/core/types";
import type { ReactNode } from "react";
import { AssistantDrawer } from "@/features/manage/AssistantDrawer.tsx";
import { CancelSignaturesDialog } from "@/features/manage/CancelSignaturesDialog.tsx";
import { RecipientsDrawer } from "@/features/manage/RecipientsDrawer.tsx";
import { RequestSignaturesDialog } from "@/features/manage/RequestSignaturesDialog.tsx";
import { VoidDialog } from "@/features/manage/VoidDialog.tsx";
import type { RunCommand } from "./commands.ts";

export type Panel = "recipients" | "assistant" | "void" | "cancel" | "request";

type WorkspacePanelsProps = Readonly<{
  view: AgreementView;
  run: RunCommand;
  busy: boolean;
  /** The open panel, if any; only it shows the command failure, since the page behind it is inert. */
  open: Panel | null;
  notice: ReactNode;
  onClose: () => void;
}>;

/**
 * Every drawer and dialog of a staff workspace, mounted once. They stay mounted while closed, so
 * half-typed text (an assistant instruction, a void reason) survives closing and reopening.
 */
export function WorkspacePanels({ view, run, busy, open, notice, onClose }: WorkspacePanelsProps) {
  const panel = (name: Panel) => ({
    open: open === name,
    view,
    run,
    busy,
    notice: open === name ? notice : null,
    onClose,
  });
  const showAssistant = view.allowedActions.includes("ask_ai") || view.aiSuggestions.length > 0;
  return (
    <>
      <RecipientsDrawer {...panel("recipients")} />
      {showAssistant && <AssistantDrawer {...panel("assistant")} />}
      <VoidDialog {...panel("void")} />
      <CancelSignaturesDialog {...panel("cancel")} />
      <RequestSignaturesDialog {...panel("request")} />
    </>
  );
}
