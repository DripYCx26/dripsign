// Recipient notifications. Mail renders from the template and the outbox row's agreement id;
// params carry only the published title (scrubbed when the job finishes), never a draft's.
import type { Db } from "../db.ts";
import { enqueue } from "../jobs/outbox.ts";
import type { EmailTemplate } from "../schema.ts";

export interface Addressee {
  readonly id: string;
  readonly email: string;
}

export interface Notification {
  readonly agreement: { readonly tenantId: string; readonly id: string };
  readonly template: EmailTemplate;
  readonly to: readonly Addressee[];
  /** Deduplicates one mail per (template, resource, recipient); null for deliberate repeats. */
  readonly resourceId: string | null;
}

export async function notify(db: Db, notification: Notification): Promise<void> {
  const { agreement, template, resourceId } = notification;
  const published = await db.query<{ title: string }>(
    `SELECT v.source ->> 'title' AS title
     FROM dripsign.agreement a
     JOIN dripsign.revision v ON v.tenant_id = a.tenant_id AND v.id = a.current_revision_id
     WHERE a.tenant_id = $1 AND a.id = $2`,
    [agreement.tenantId, agreement.id],
  );
  const title = published.rows[0]?.title;
  if (title === undefined) throw new Error(`Agreement ${agreement.id} has no published revision`);
  for (const addressee of notification.to) {
    await enqueue(db, {
      tenantId: agreement.tenantId,
      agreementId: agreement.id,
      dedupeKey: resourceId === null ? null : `email:${template}:${resourceId}:${addressee.id}`,
      payload: { kind: "email", to: addressee.email, template, params: { title } },
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
