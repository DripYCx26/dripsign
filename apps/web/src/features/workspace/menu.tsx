import type { AgreementView, Capacity } from "@dripsign/core/types";
import type { ReactNode } from "react";
import { Ban, Download, Sparkles, Undo2, Users } from "@/ui";

export type MenuId = "recipients" | "assistant" | "download" | "cancel" | "void";

type MenuItem = Readonly<{ id: MenuId; label: string; icon: ReactNode; danger?: boolean }>;

/**
 * The overflow menu's items for this viewer. Each exists only where the policy allows it, so an
 * empty list means no menu. Reminding signers is not here: no command sends one.
 */
export function menuItems(view: AgreementView, capacity: Capacity): readonly MenuItem[] {
  const can = (action: AgreementView["allowedActions"][number]) =>
    view.allowedActions.includes(action);
  const staff = capacity === "staff";
  const items: (MenuItem | false)[] = [
    staff && { id: "recipients", label: "Recipients", icon: <Users /> },
    staff && can("ask_ai") && { id: "assistant", label: "Private assistant", icon: <Sparkles /> },
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
