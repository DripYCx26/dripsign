"use client";

import { LIMITS } from "@dripsign/core/schema";
import { useState } from "react";
import { Dialog, TextArea } from "@/ui";
import type { PanelProps } from "./panel.ts";

/** Voiding ends the agreement for everyone and is permanent, so it is a danger dialog. */
export function VoidDialog({ open, view, run, busy, notice, onClose }: PanelProps) {
  const [reason, setReason] = useState("");

  async function confirm() {
    const trimmed = reason.trim();
    const ok = await run(
      {
        kind: "void",
        expectedVersion: view.agreement.version,
        ...(trimmed === "" ? {} : { reason: trimmed }),
      },
      "void",
    );
    if (ok) onClose();
  }

  return (
    <Dialog
      open={open}
      title="Void this agreement?"
      tone="danger"
      confirmLabel="Void agreement"
      loading={busy}
      onConfirm={() => void confirm()}
      onClose={onClose}
    >
      <p>
        Everyone loses the ability to propose or sign. Published revisions and any signatures stay
        as records. This can&rsquo;t be undone.
      </p>
      <TextArea
        label="Reason (optional)"
        name="void-reason"
        maxLength={LIMITS.voidReason}
        value={reason}
        onChange={setReason}
      />
      {notice}
    </Dialog>
  );
}
