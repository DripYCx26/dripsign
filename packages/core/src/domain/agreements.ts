// Agreement creation and voiding.
import { randomUUID } from "node:crypto";
import type { Db } from "../db.ts";
import type { CommandOf, NewAgreementInput } from "../schema.ts";
import type { StaffActor } from "../types.ts";
import { liveRecipients, notify } from "./notify.ts";
import { EMPTY_DRAFT, stageDraft } from "./revisions.ts";
import { voidRound } from "./signing.ts";
import { AGREEMENT_COLUMNS, liveSigners } from "./state.ts";
import type { AgreementRow, CommandContext } from "./state.ts";

/** Inserts the agreement and its recipients, then stages the draft for the live signers. */
export async function insertAgreement(
  db: Db,
  actor: StaffActor,
  input: NewAgreementInput,
): Promise<string> {
  const inserted = await db.query<AgreementRow>(
    `INSERT INTO dripsign.agreement (tenant_id, id, title, draft, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${AGREEMENT_COLUMNS}`,
    [actor.tenantId, randomUUID(), input.title, JSON.stringify(EMPTY_DRAFT), actor.email],
  );
  const agreement = inserted.rows[0];
  if (agreement === undefined) throw new Error("Agreement insert returned no row");
  // In the order the staff member listed them: added_at orders the signature page.
  for (const recipient of input.recipients) {
    await db.query(
      `INSERT INTO dripsign.recipient (tenant_id, agreement_id, id, email, name, is_signer)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        agreement.tenantId,
        agreement.id,
        randomUUID(),
        recipient.email,
        recipient.name,
        recipient.isSigner,
      ],
    );
  }
  await stageDraft(db, agreement, {
    source: input.source,
    signers: await liveSigners(db, agreement.tenantId, agreement.id),
    dirty: true,
  });
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
