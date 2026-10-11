"use client";

import type { AgreementView, Capacity } from "@dripsign/core/types";
import { fileUrl } from "@/features/files.ts";
import { Ellipsis, Menu } from "@/ui";
import type { RunCommand } from "./commands.ts";
import { menuItems, type MenuId } from "./menu.tsx";
import type { NextStep } from "./nextStep.ts";
import { PrimaryAction } from "./PrimaryAction.tsx";
import type { Panel } from "./WorkspacePanels.tsx";

type PrimaryProps = Readonly<{
  step: NextStep;
  run: RunCommand;
  busy: boolean;
  onPanel: (panel: Panel) => void;
  onReveal: (href: string) => void;
}>;

/**
 * The header's primary action, the one `nextStep` chose. Requesting signatures goes through its
 * confirmation dialog; other commands run at once.
 */
export function WorkspacePrimary({ step, run, busy, onPanel, onReveal }: PrimaryProps) {
  return (
    <PrimaryAction
      step={step}
      busy={busy}
      onCommand={(command) => {
        if (command.kind === "request_signatures") onPanel("request");
        else void run(command, command.kind);
      }}
      onReveal={onReveal}
    />
  );
}

/** The overflow menu, if the policy gives this viewer any item. */
export function WorkspaceMenu({
  view,
  capacity,
  onPanel,
}: Readonly<{
  view: AgreementView;
  capacity: Capacity;
  onPanel: (panel: Panel) => void;
}>) {
  const items = menuItems(view, capacity);
  if (items.length === 0) return null;

  function onMenu(id: MenuId) {
    if (id === "audit") {
      window.location.assign(fileUrl(view.agreement.id, "audit", { as: capacity }));
    } else if (id === "download") {
      const kind = view.agreement.currentRevisionNumber === null ? "draft" : "current";
      window.location.assign(fileUrl(view.agreement.id, kind, { as: capacity }));
    } else {
      onPanel(id);
    }
  }

  return <Menu label="More actions" icon={<Ellipsis />} items={items} onAction={onMenu} />;
}
