// Recipient notifications. Mail renders from the template and the outbox row's agreement id;
// params carry only the agreement title (scrubbed when the job finishes).
import type { Db } from "../db.ts";
import { enqueue } from "../jobs/outbox.ts";
import type { EmailTemplate } from "../schema.ts";

export interface Addressee {
  readonly id: string;
  readonly email: string;
}

export interface Notification {
  readonly agreement: { readonly tenantId: string; readonly id: string; readonly title: string };
  readonly template: EmailTemplate;
  readonly to: readonly Addressee[];
  /** Deduplicates one mail per (template, resource, recipient); null for deliberate repeats. */
  readonly resourceId: string | null;
}

export async function notify(db: Db, notification: Notification): Promise<void> {
  const { agreement, template, resourceId } = notification;
  for (const addressee of notification.to) {
    await enqueue(db, {
      tenantId: agreement.tenantId,
      agreementId: agreement.id,
      dedupeKey: resourceId === null ? null : `email:${template}:${resourceId}:${addressee.id}`,
      payload: { kind: "email", to: addressee.email, template, params: { title: agreement.title } },
    });
  }
}

/** Invitations and signing requests start the resend window. */
export async function markInvited(
  db: Db,
  tenantId: string,
  recipientIds: readonly string[],
): Promise<void> {
  await db.query(
    `UPDATE dripsign.recipient SET last_invited_at = now()
     WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, recipientIds],
  );
}

export async function liveRecipients(
  db: Db,
  tenantId: string,
  agreementId: string,
): Promise<Addressee[]> {
  const found = await db.query<Addressee>(
    `SELECT id, email FROM dripsign.recipient
     WHERE tenant_id = $1 AND agreement_id = $2 AND revoked_at IS NULL
     ORDER BY added_at, id`,
    [tenantId, agreementId],
  );
  return found.rows;
}
