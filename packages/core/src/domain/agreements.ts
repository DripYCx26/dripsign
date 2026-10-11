// Agreement creation and voiding.
import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import { draftSchema } from "../schema.ts";
import type { CommandOf, NewAgreementInput } from "../schema.ts";
import type { StaffActor } from "../types.ts";
import { liveRecipients, notify } from "./notify.ts";
import { enqueuePreparation, nextDraft } from "./revisions.ts";
import { voidRound } from "./signing.ts";
import type { CommandContext, LiveSigner } from "./state.ts";

/** Inserts the draft and its recipients; written terms start preparing at once. */
export async function insertAgreement(
  db: Db,
  actor: StaffActor,
  input: NewAgreementInput,
): Promise<string> {
  const agreement = { tenantId: actor.tenantId, id: randomUUID() };
  const recipients = input.recipients.map((recipient) => ({ ...recipient, id: randomUUID() }));
  const signers: LiveSigner[] = recipients
    .filter((recipient) => recipient.isSigner)
    .map(({ id, name, email }) => ({ id, name, email }));
  const source = input.document.kind === "source" ? input.document.source : null;
  const { draft, fence } = nextDraft(null, {
    title: input.title,
    content: { source, upload: null },
    signers,
  });
  await db.query(
    `INSERT INTO dripsign.agreement (tenant_id, id, title, draft, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      agreement.tenantId,
      agreement.id,
      input.title,
      JSON.stringify(draftSchema.parse(draft)),
      actor.email,
    ],
  );
  // added_at orders the signature page, so insert in the order the staff member listed them.
  for (const recipient of recipients) {
    await db.query(
      `INSERT INTO dripsign.recipient (tenant_id, agreement_id, id, email, name, is_signer, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
      [
        agreement.tenantId,
        agreement.id,
        recipient.id,
        recipient.email,
        recipient.name,
        recipient.isSigner,
      ],
    );
  }
  if (fence !== null) await enqueuePreparation(db, agreement, fence);
  return agreement.id;
}

/** Voids from any open state; an active round ends with it and its signatures stay as records. */
export async function voidAgreement(
  ctx: CommandContext,
  command: CommandOf<"void">,
): Promise<void> {
  const { db, agreement, state, actor } = ctx;
  if (state.round !== null) await voidRound(db, agreement, state.round, "agreement_voided");
  await db.query(
    `UPDATE dripsign.agreement
     SET status = 'void', voided_at = now(), voided_by = $3, void_reason = $4
     WHERE tenant_id = $1 AND id = $2`,
    [agreement.tenantId, agreement.id, actor.email, command.reason ?? null],
  );
  // Recipients never saw an unpublished draft, so there is nobody to tell.
  if (agreement.currentRevisionId === null) return;
  const recipients = await liveRecipients(db, agreement.tenantId, agreement.id);
  await notify(db, { agreement, template: "voided", to: recipients, resourceId: agreement.id });
}
