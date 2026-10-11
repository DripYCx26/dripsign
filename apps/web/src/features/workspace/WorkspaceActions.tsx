"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import { fileUrl } from "@/features/files.ts";
import { Ellipsis, Menu } from "@/ui";
import type { RunCommand } from "./commands.ts";
import { menuItems, type MenuId } from "./menu.tsx";
import { nextStep } from "./nextStep.ts";
import { PrimaryAction } from "./PrimaryAction.tsx";
import type { Panel } from "./WorkspacePanels.tsx";

type WorkspaceActionsProps = Readonly<{
  view: AgreementView;
  capacity: Capacity;
  run: RunCommand;
  busy: boolean;
  onPanel: (panel: Panel) => void;
  onReveal: (href: string) => void;
}>;

/**
 * The header's actions: the primary one `nextStep` chose and the overflow menu, if it has items.
 * Requesting signatures goes through its confirmation dialog; other commands run at once.
 */
export function WorkspaceActions({
  view,
  capacity,
  run,
  busy,
  onPanel,
  onReveal,
}: WorkspaceActionsProps) {
  const items = menuItems(view, capacity);

  function onMenu(id: MenuId) {
    if (id !== "download") {
      onPanel(id);
      return;
    }
    const kind = view.agreement.currentRevisionNumber === null ? "draft" : "current";
    window.location.assign(fileUrl(view.agreement.id, kind, { as: capacity }));
  }

  return (
    <>
      <PrimaryAction
        step={nextStep(capacity, view)}
        busy={busy}
        onCommand={(command) => {
          if (command.kind === "request_signatures") onPanel("request");
          else void run(command, command.kind);
        }}
        onReveal={onReveal}
      />
      {items.length > 0 && (
        <Menu label="More actions" icon={<Ellipsis />} items={items} onAction={onMenu} />
      )}
    </>
  );
}
