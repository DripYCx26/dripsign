import { canonicalJson } from './json.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction } from './connection.ts';
import { bounded, emailAddress } from './validation.ts';
import { StoreError } from './types.ts';
import type { Actor, Agreement, DocumentDraft, JobFence, Mutation, NewOutboxMessage, StaffActor } from './types.ts';

export const AGREEMENT_COLUMNS = 'id, tenant_id AS "tenantId", title, status, version, draft_dirty AS "publicationNeeded", current_revision_id AS "currentRevisionId", created_at::text AS "createdAt"';
export interface LockedAgreement extends Agreement { readonly draft: DocumentDraft }
export function actorKey(actor: Actor): string { return `${actor.kind}:${actor.kind === 'staff' ? actor.userId : actor.grantId}`; }
export class StoreBase {
  readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  protected derivedKey(namespace:string,key:string):string { return `${namespace}:${createHash('sha256').update(key).digest('hex')}`; }
  protected async staff(client: PoolClient, actor: StaffActor): Promise<void> {
    const result = await client.query('SELECT 1 FROM dripsign.staff_membership WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR SHARE', [actor.tenantId, actor.userId]);
    if (!result.rowCount) throw new StoreError('not_found', 'Resource not found');
  }
  async assertStaff(actor: StaffActor): Promise<void> { await transaction(this.pool, (client) => this.staff(client, actor)); }
  protected async authorize(client: PoolClient, actor: Actor, agreementId: string): Promise<void> {
    if (actor.kind === 'staff') return this.staff(client, actor);
    if (actor.agreementId !== agreementId) throw new StoreError('not_found', 'Resource not found');
    const result = await client.query('SELECT 1 FROM dripsign.recipient_grant WHERE tenant_id=$1 AND agreement_id=$2 AND id=$3 AND email=$4 AND revoked_at IS NULL FOR SHARE', [actor.tenantId, agreementId, actor.grantId, emailAddress(actor.email)]);
    if (!result.rowCount) throw new StoreError('not_found', 'Resource not found');
  }
  protected async locked(client: PoolClient, actor: Actor, agreementId: string): Promise<LockedAgreement> {
    await this.authorize(client, actor, agreementId);
    const result = await client.query<LockedAgreement>(`SELECT ${AGREEMENT_COLUMNS}, draft FROM dripsign.agreement WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [actor.tenantId, agreementId]);
    const agreement = result.rows[0];
    if (!agreement || (actor.kind === 'recipient' && !agreement.currentRevisionId)) throw new StoreError('not_found', 'Resource not found');
    return agreement;
  }
  protected async lockedRecovery(client:PoolClient,tenantId:string,agreementId:string,roundId:string):Promise<LockedAgreement> {
    const agreement=(await client.query<LockedAgreement>(`SELECT ${AGREEMENT_COLUMNS},draft FROM dripsign.agreement WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,agreementId])).rows[0];
    if(!agreement||!agreement.currentRevisionId||!['signing','signed','negotiating'].includes(agreement.status))throw new StoreError('not_found','Resource not found');
    const round=(await client.query('SELECT 1 FROM dripsign.signing_round WHERE tenant_id=$1 AND agreement_id=$2 AND id=$3 AND revision_id=$4 FOR UPDATE',[tenantId,agreementId,roundId,agreement.currentRevisionId])).rowCount;
    if(!round)throw new StoreError('not_found','Resource not found');
    return agreement;
  }
  protected async fence(client: PoolClient, fence: JobFence): Promise<void> {
    const result = await client.query('SELECT 1 FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2 AND lease_token=$3 AND status=\'delivering\' AND lease_until>now() FOR UPDATE', [fence.tenantId, fence.id, fence.leaseToken]);
    if (!result.rowCount) throw new StoreError('conflict', 'Job lease is no longer current');
  }
  protected async bump(client: PoolClient, agreement: Agreement): Promise<Agreement> {
    const result = await client.query<Agreement>(`UPDATE dripsign.agreement SET version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING ${AGREEMENT_COLUMNS}`, [agreement.tenantId, agreement.id]);
    const next = result.rows[0];
    if (!next) throw new StoreError('not_found', 'Resource not found');
    return next;
  }
  protected async mutate<T>(command: Mutation, operation: string, data: unknown, action: (client: PoolClient, agreement: LockedAgreement) => Promise<T>, fence?: JobFence): Promise<T> {
    bounded(command.idempotencyKey, 'Idempotency key', 200, 8);
    if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) throw new StoreError('invalid', 'Version is invalid');
    return transaction(this.pool, async (client) => {
      if (fence) {
        if (fence.tenantId !== command.actor.tenantId) throw new StoreError('not_found', 'Resource not found');
        await this.fence(client, fence);
        const job=(await client.query<{agreement_id:string}>('SELECT agreement_id FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2',[fence.tenantId,fence.id])).rows[0];
        if(job?.agreement_id!==command.agreementId)throw new StoreError('not_found','Resource not found');
      }
      const agreement = await this.locked(client, command.actor, command.agreementId);
      const hash = createHash('sha256').update(canonicalJson({ agreementId: command.agreementId, expectedVersion: command.expectedVersion, data })).digest('hex');
      const key = actorKey(command.actor);
      const previous = await client.query<{ request_hash: string; result: T }>('SELECT request_hash,result FROM dripsign.idempotency WHERE tenant_id=$1 AND actor_key=$2 AND operation=$3 AND key=$4', [agreement.tenantId, key, operation, command.idempotencyKey]);
      if (previous.rows[0]) {
        if (previous.rows[0].request_hash !== hash) throw new StoreError('conflict', 'Idempotency key was already used');
        return previous.rows[0].result;
      }
      if (agreement.version !== command.expectedVersion) throw new StoreError('conflict', 'Agreement changed; reload it');
      const result = await action(client, agreement);
      await client.query('INSERT INTO dripsign.idempotency(tenant_id,actor_key,operation,key,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)', [agreement.tenantId, key, operation, command.idempotencyKey, hash, JSON.stringify(result)]);
      return result;
    });
  }
  protected async enqueue(client: PoolClient, message: NewOutboxMessage): Promise<string> {
    bounded(message.dedupeKey, 'Delivery key', 300);
    const result = await client.query<{ id: string }>('INSERT INTO dripsign.outbox(tenant_id,id,agreement_id,kind,dedupe_key,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,dedupe_key) DO NOTHING RETURNING id', [message.tenantId, randomUUID(), message.agreementId, message.kind, message.dedupeKey, JSON.stringify(message.payload)]);
    if (result.rows[0]) return result.rows[0].id;
    const prior = await client.query<{ id: string; kind: string; agreement_id: string | null; payload: unknown }>('SELECT id,kind,agreement_id,payload FROM dripsign.outbox WHERE tenant_id=$1 AND dedupe_key=$2', [message.tenantId, message.dedupeKey]);
    const row = prior.rows[0];
    if (!row || row.kind !== message.kind || row.agreement_id !== message.agreementId || canonicalJson(row.payload) !== canonicalJson(message.payload)) throw new StoreError('conflict', 'Delivery key was already used');
    return row.id;
  }
}
