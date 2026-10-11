"use client";

import { Dialog } from "@/ui";
import { currentRevision } from "@/features/thread/model.ts";
import type { PanelProps } from "./panel.ts";

/** Names the signers frozen into the revision before staff send the request. */
export function RequestSignaturesDialog({ open, view, run, busy, notice, onClose }: PanelProps) {
  const revision = currentRevision(view);
  const signers = (revision?.signerIds ?? []).map(
    (id) => view.recipients.find((recipient) => recipient.id === id)?.name ?? "A removed recipient",
  );

  async function confirm() {
    const command = {
      kind: "request_signatures",
      expectedVersion: view.agreement.version,
    } as const;
    if (await run(command, "request_signatures")) onClose();
  }

  return (
    <Dialog
      open={open}
      title="Request signatures?"
      confirmLabel="Request signatures"
      loading={busy}
      onConfirm={() => void confirm()}
      onClose={onClose}
    >
      <p>
        {`These people are asked to sign revision ${String(revision?.number ?? "")}. Signers are fixed once you request. Cancel the request to change them.`}
      </p>
      <ul>
        {signers.map((name, index) => (
          // Names may repeat; the frozen order is stable for one revision.
          <li key={`${name}-${String(index)}`}>{name}</li>
        ))}
      </ul>
      {notice}
    </Dialog>
  );
}
