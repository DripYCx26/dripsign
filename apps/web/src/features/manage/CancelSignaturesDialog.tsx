"use client";

import { Dialog } from "@/ui";
import type { PanelProps } from "./panel.ts";

/** Staff end a live signature request; signatures already recorded stay as evidence. */
export function CancelSignaturesDialog({ open, view, run, busy, notice, onClose }: PanelProps) {
  const round = view.activeRound;

  async function confirm() {
    if (round?.status !== "active") return;
    const command = {
      kind: "cancel_signatures",
      expectedVersion: view.agreement.version,
      roundId: round.id,
    } as const;
    if (await run(command, "cancel_signatures")) onClose();
  }

  return (
    <Dialog
      open={open}
      title="Cancel the signature request?"
      confirmLabel="Cancel signature request"
      loading={busy}
      onConfirm={() => void confirm()}
      onClose={onClose}
    >
      <p>
        Signers can no longer sign this request. Signatures already recorded are kept as evidence.
        You can request signatures again afterwards.
      </p>
      {notice}
    </Dialog>
  );
}
