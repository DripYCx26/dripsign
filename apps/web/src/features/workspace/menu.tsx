import type { AgreementView, Capacity } from "@dripsign/core/types";
import type { ReactNode } from "react";
import { formatBytes } from "@/features/signing/format.ts";
import { railMode } from "./tabs.ts";
import { Ban, Download, FileText, Sparkles, Undo2, Users } from "@/ui";

export type MenuId = "audit" | "recipients" | "assistant" | "download" | "cancel" | "void";

type MenuItem = Readonly<{ id: MenuId; label: string; icon: ReactNode; danger?: boolean }>;

/** The completed round's audit record, once the archive worker has stored it. */
function auditRecord(view: AgreementView) {
  const round = view.completedRound;
  return round === null
    ? undefined
    : view.artifacts.find((a) => a.roundId === round.id && a.kind === "audit_record");
}

/**
 * The overflow menu's items for this viewer. Each exists only where the policy allows it, so an
 * empty list means no menu. Reminding signers is not here: no command sends one.
 */
export function menuItems(view: AgreementView, capacity: Capacity): readonly MenuItem[] {
  const can = (action: AgreementView["allowedActions"][number]) =>
    view.allowedActions.includes(action);
  const staff = capacity === "staff";
  const audit = view.agreement.status === "signed" ? auditRecord(view) : undefined;
  const items: (MenuItem | false)[] = [
    audit !== undefined && {
      id: "audit",
      label: `Audit record · ${formatBytes(audit.byteLength)}`,
      icon: <FileText />,
    },
    staff && { id: "recipients", label: "Recipients", icon: <Users /> },
    // While drafting the assistant is the rail, so the drawer is only for a negotiation.
    staff &&
      can("ask_ai") &&
      railMode(view) !== "draft" && {
        id: "assistant",
        label: "Private assistant",
        icon: <Sparkles />,
      },
    can("download") && { id: "download", label: "Download current PDF", icon: <Download /> },
    staff &&
      can("cancel_signatures") &&
      view.activeRound?.status === "active" && {
        id: "cancel",
        label: "Cancel signature request",
        icon: <Undo2 />,
      },
    staff && can("void") && { id: "void", label: "Void agreement", icon: <Ban />, danger: true },
  ];
  return items.filter((item) => item !== false);
}
