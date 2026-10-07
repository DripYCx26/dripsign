import 'server-only';
import type { Actor, AuthSession, Agreement, AgreementDetail } from '@dripsign/db';
import { getStore } from './store';

/** Mailbox identity is resolved to a live exact grant for each agreement. */
export async function agreementActor(actor: AuthSession['actor'], agreementId: string): Promise<Actor> {
  return actor.kind === 'staff' ? actor : getStore().resolveRecipientActor(actor, agreementId);
}

export async function listAgreements(actor: AuthSession['actor'], beforeId: string | null = null): Promise<readonly Agreement[]> {
  return actor.kind === 'staff' ? getStore().listAgreementInbox(actor, 50, beforeId) : getStore().listRecipientAgreements(actor, 50, beforeId);
}

export async function getAgreement(actor: AuthSession['actor'], agreementId: string): Promise<AgreementDetail> {
  return getStore().getAgreement(await agreementActor(actor, agreementId), agreementId);
}
