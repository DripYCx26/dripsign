import 'server-only';
import { z } from 'zod';
import type { Actor, AuthSession, Agreement, AgreementDetail } from '@dripsign/db';
import { getStore } from './store';
import { HttpError } from './http';

const agreementListSchema = z.strictObject({ before: z.uuid().optional(), view: z.enum(['outstanding', 'received', 'all']).default('all') });

/** List queries reject duplicate, unknown, or malformed cursor and view parameters. */
export function agreementListQuery(request: Request): z.output<typeof agreementListSchema> {
  const params = new URL(request.url).searchParams;
  if (new Set(params.keys()).size !== [...params].length) throw new HttpError(400, 'invalid_request');
  return agreementListSchema.parse(Object.fromEntries(params));
}

/** Mailbox identity is resolved to a live exact grant for each agreement. */
export async function agreementActor(actor: AuthSession['actor'], agreementId: string): Promise<Actor> {
  return actor.kind === 'staff' ? actor : getStore().resolveRecipientActor(actor, agreementId);
}

export async function listAgreements(actor: AuthSession['actor'], beforeId: string | null = null,
  view: NonNullable<Parameters<ReturnType<typeof getStore>['listAgreementInbox']>[3]> = 'all'): Promise<readonly Agreement[]> {
  if (actor.kind === 'staff') return getStore().listAgreementInbox(actor, 50, beforeId, view);
  if (view !== 'all') throw new HttpError(400, 'invalid_request');
  return getStore().listRecipientAgreements(actor, 50, beforeId);
}

export async function getAgreement(actor: AuthSession['actor'], agreementId: string): Promise<AgreementDetail> {
  return getStore().getAgreement(await agreementActor(actor, agreementId), agreementId);
}
