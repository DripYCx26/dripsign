"use client";

import type { AgreementView, RecipientView } from "@dripsign/core/types";
import { useState } from "react";
import { Button, Dialog, Drawer, Notice, Pill, Switch } from "@/ui";
import { AddRecipientForm } from "./AddRecipientForm.tsx";
import type { PanelProps } from "./panel.ts";
import styles from "./RecipientsDrawer.module.css";

type Standing = "removed" | "signed" | "invited" | "waiting";

/** Where a person stands: gone, signed, invited, or added but not yet invited (before publishing). */
function standing(view: AgreementView, recipient: RecipientView): Standing {
  if (recipient.removedAt !== null) return "removed";
  const round = view.activeRound ?? view.completedRound;
  const signed = round?.signers.some(
    (signer) => signer.recipientId === recipient.id && signer.signature !== null,
  );
  if (signed === true) return "signed";
  return recipient.lastInvitedAt === null ? "waiting" : "invited";
}

function StandingPill({ standing: state }: Readonly<{ standing: Standing }>) {
  switch (state) {
    case "removed":
      return <Pill tone="stop">Removed</Pill>;
    case "signed":
      return <Pill tone="confirm">Signed</Pill>;
    case "invited":
      return <Pill tone="info">Invited</Pill>;
    case "waiting":
      return <Pill tone="info">Not invited yet</Pill>;
  }
}

type RowProps = Readonly<{
  view: AgreementView;
  recipient: RecipientView;
  readOnly: boolean;
  busy: boolean;
  working: boolean;
  onResend: () => void;
  onRemove: () => void;
  onSetSigner: (isSigner: boolean) => void;
}>;

function RecipientRow(props: RowProps) {
  const { view, recipient, readOnly, busy, working, onResend, onRemove, onSetSigner } = props;
  const state = standing(view, recipient);
  const live = state !== "removed";
  const canResend = live && view.allowedActions.includes("resend_invite");
  const canRemove = live && !readOnly && view.allowedActions.includes("remove_recipient");
  const canSetSigner = live && view.allowedActions.includes("set_signer");
  return (
    <li className={styles.row} data-removed={!live || undefined}>
      <div className={styles.who}>
        <p className={styles.name}>{recipient.name}</p>
        <p className={styles.email}>{recipient.email}</p>
      </div>
      <div className={styles.marks}>
        {canSetSigner ? (
          <Switch
            label="Required signer"
            subject={recipient.name}
            checked={recipient.isSigner}
            disabled={busy}
            onChange={onSetSigner}
          />
        ) : (
          recipient.isSigner && <Pill tone="info">Required</Pill>
        )}
        <StandingPill standing={state} />
      </div>
      {(canResend || canRemove) && (
        <div className={styles.actions}>
          {canResend && (
            <Button
              variant="secondary"
              size="sm"
              loading={working}
              disabled={busy && !working}
              onClick={onResend}
            >
              Resend invite
            </Button>
          )}
          {canRemove && (
            <Button variant="quiet" size="sm" disabled={busy} onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

type RemoveDialogProps = Readonly<
  Pick<PanelProps, "view" | "run" | "busy" | "notice" | "onClose"> & {
    recipient: RecipientView | null;
  }
>;

/** Confirms removing one person; open while `recipient` is set, closed once the removal applied. */
function RemoveDialog({ view, recipient, run, busy, notice, onClose }: RemoveDialogProps) {
  async function remove(target: RecipientView) {
    const command = {
      kind: "remove_recipient",
      expectedVersion: view.agreement.version,
      recipientId: target.id,
    } as const;
    if (await run(command, `remove:${target.id}`)) onClose();
  }

  return (
    <Dialog
      open={recipient !== null}
      title={`Remove ${recipient?.name ?? "this person"}?`}
      confirmLabel="Remove"
      tone="danger"
      loading={busy}
      onConfirm={() => {
        if (recipient !== null) void remove(recipient);
      }}
      onClose={onClose}
    >
      <p>They lose access now. Their messages stay in the thread.</p>
      {recipient !== null && notice}
    </Dialog>
  );
}

/**
 * The people on the agreement, staff only. Membership is read-only while a signature request is
 * live: the signers are frozen into the round. Resending an invite stays possible.
 */
export function RecipientsDrawer({ open, view, run, busy, notice, onClose }: PanelProps) {
  const [removing, setRemoving] = useState<RecipientView | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [sent, setSent] = useState("");
  const readOnly = view.activeRound?.status === "active";
  const rows = [...view.recipients].sort((a, b) => Date.parse(a.addedAt) - Date.parse(b.addedAt));

  async function resend(recipient: RecipientView) {
    setWorking(recipient.id);
    setSent("");
    const ok = await run(
      { kind: "resend_invite", recipientId: recipient.id },
      `resend:${recipient.id}`,
    );
    setWorking(null);
    if (ok) setSent(`Invite sent to ${recipient.name}.`);
  }

  async function setSigner(recipient: RecipientView, isSigner: boolean) {
    const command = {
      kind: "set_signer",
      expectedVersion: view.agreement.version,
      recipientId: recipient.id,
      isSigner,
    } as const;
    await run(command, `set_signer:${recipient.id}`);
  }

  return (
    <>
      <Drawer open={open} title="Recipients" width={440} onClose={onClose}>
        <div className={styles.drawer}>
          {removing === null && notice}
          {readOnly && (
            <Notice tone="info">
              Signers are fixed while signatures are requested. Cancel the request to change them.
            </Notice>
          )}
          <ul className={styles.list}>
            {rows.map((recipient) => (
              <RecipientRow
                key={recipient.id}
                view={view}
                recipient={recipient}
                readOnly={readOnly}
                busy={busy}
                working={working === recipient.id}
                onResend={() => void resend(recipient)}
                onRemove={() => {
                  setRemoving(recipient);
                }}
                onSetSigner={(isSigner) => void setSigner(recipient, isSigner)}
              />
            ))}
          </ul>
          <p className={styles.note} role="status">
            {sent}
          </p>
          {!readOnly && view.allowedActions.includes("add_recipient") && (
            <AddRecipientForm view={view} run={run} busy={busy} />
          )}
        </div>
      </Drawer>
      <RemoveDialog
        view={view}
        recipient={removing}
        run={run}
        busy={busy}
        notice={notice}
        onClose={() => {
          setRemoving(null);
        }}
      />
    </>
  );
}
