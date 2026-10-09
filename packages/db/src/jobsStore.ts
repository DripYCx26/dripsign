import { configureCompletionExport, freezeCompletionExport, recoverCompletionExport, type CompletionExportConfig } from './completionExport.ts';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AuthStore } from './auth.ts';
import { transaction } from './connection.ts';
import { bounded, jobMutation, parseMailJobPayload, parseArchiveJobPayload, parseProposalAiJobPayload } from './validation.ts';
import { StoreError } from './types.ts';
import type { AiReservation, ExecutedAgreementEvent, JobFence, NewOutboxMessage, OutboxAdmission, OutboxContext, OutboxMessage } from './types.ts';

const OUTBOX_COLUMNS = 'id,tenant_id AS "tenantId",agreement_id AS "agreementId",kind,dedupe_key AS "dedupeKey",payload,status,lease_token AS "leaseToken",attempts';
const RETRY_KINDS: readonly OutboxMessage['kind'][] = ['archive', 'agreement_executed'];
const RECOVERY_KINDS: readonly OutboxMessage['kind'][] = ['archive'];
// ASSUMPTION: pilot limits ratified for initial operation; configuration may lower them.
const ADMISSION: OutboxAdmission = { globalConcurrency: 4, tenantConcurrency: 2, globalPerMinute: 60, tenantPerMinute: 20 };
// ASSUMPTION: the pilot admits at most $10 of resolved and reserved AI cost per tenant UTC day.
const AI_DAILY_LIMIT_MICROS = 10_000_000;
const MAX_ATTEMPTS = 5;

function positiveInteger(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new StoreError('invalid', 'Job limit is invalid');
}

export class DripSignStore extends AuthStore {
  // This internal worker catalog intentionally spans tenants; document access remains tenant-scoped.
  async listOutboxTenants(limit = 100, recoveryOnly = false): Promise<readonly string[]> {
    positiveInteger(limit, 100);
    return transaction(this.pool, async (client) => {
      const rows = await client.query<{ id: string }>(`SELECT t.id FROM dripsign.tenant t
        WHERE EXISTS (SELECT 1 FROM dripsign.outbox o WHERE o.tenant_id=t.id
          AND ((o.status='pending' AND o.available_at<=now() AND (NOT $2::boolean OR o.kind=ANY($3::text[])))
            OR (o.status='delivering' AND o.lease_until<=now())))
        ORDER BY t.last_outbox_claim_at ASC NULLS FIRST,t.id LIMIT $1`, [limit, recoveryOnly, RECOVERY_KINDS]);
      return rows.rows.map((row) => row.id);
    });
  }

  async claimOutbox(tenantId: string, limit = 10, leaseMs = 60_000, admission: OutboxAdmission = ADMISSION, recoveryOnly = false): Promise<OutboxMessage[]> {
    positiveInteger(limit, 100); positiveInteger(leaseMs, 300_000);
    for (const key of ['globalConcurrency', 'tenantConcurrency', 'globalPerMinute', 'tenantPerMinute'] as const) positiveInteger(admission[key], ADMISSION[key]);
    return transaction(this.pool, async (client) => {
      // All processes use this lock for the global admission counts and inserts.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dripsign:outbox-admission',0))");
      await client.query('UPDATE dripsign.tenant SET last_outbox_claim_at=now() WHERE id=$1', [tenantId]);
      const expired = await client.query<OutboxMessage>(`UPDATE dripsign.outbox SET
        status=CASE WHEN kind='pdf_prepare' THEN 'failed' WHEN kind=ANY($2::text[]) AND attempts<$3 THEN 'pending'
          WHEN kind=ANY($2::text[]) THEN 'failed' ELSE 'uncertain' END,
        effect_started_at=CASE WHEN kind=ANY($2::text[]) THEN NULL ELSE effect_started_at END,
        lease_token=NULL,lease_until=NULL,receipt='lease_expired'
        WHERE tenant_id=$1 AND status='delivering' AND lease_until<=now() RETURNING ${OUTBOX_COLUMNS}`, [tenantId, RETRY_KINDS, MAX_ATTEMPTS]);
      for (const message of expired.rows) {
        if (message.kind === 'proposal_ai_suggestion') await this.closeProposalCandidate(client, message, 'uncertain');
        if (message.kind === 'pdf_prepare') await this.failPdfDraft(client, message, 'lease_expired');
      }
      const active = (await client.query<{ global: number; tenant: number }>(`SELECT count(*)::int AS global,
        count(*) FILTER(WHERE tenant_id=$1)::int AS tenant FROM dripsign.outbox
        WHERE status='delivering' AND lease_until>now()`, [tenantId])).rows[0];
      const recent = (await client.query<{ global: number; tenant: number }>(`SELECT count(*)::int AS global,
        count(*) FILTER(WHERE tenant_id=$1)::int AS tenant FROM dripsign.outbox_claim
        WHERE claimed_at>now()-interval '1 minute'`, [tenantId])).rows[0];
      if (!active || !recent) throw new Error('Job admission count returned no row');
      const capacity = Math.min(limit, admission.globalConcurrency-active.global, admission.tenantConcurrency-active.tenant,
        admission.globalPerMinute-recent.global, admission.tenantPerMinute-recent.tenant);
      if (capacity < 1) return [];
      const messages: OutboxMessage[] = [];
      // Claim one row at a time so each next candidate sees the agreement's newly held lease.
      for (let index = 0; index < capacity; index += 1) {
        const candidate = (await client.query<{ id: string }>(`SELECT o.id FROM dripsign.outbox o
          WHERE o.tenant_id=$1 AND o.status='pending' AND o.available_at<=now() AND o.attempts<$2
          AND (NOT $3::boolean OR o.kind=ANY($4::text[]))
          AND (o.agreement_id IS NULL OR NOT EXISTS (SELECT 1 FROM dripsign.outbox active
            WHERE active.tenant_id=o.tenant_id AND active.agreement_id=o.agreement_id AND active.status='delivering'))
          ORDER BY o.available_at,o.created_at,o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`, [tenantId, MAX_ATTEMPTS, recoveryOnly, RECOVERY_KINDS])).rows[0];
        if (!candidate) break;
        const message = (await client.query<OutboxMessage>(`UPDATE dripsign.outbox
          SET status='delivering',lease_token=$3,lease_until=now()+($4::int*interval '1 millisecond'),
          claimed_at=now(),attempts=attempts+1,effect_started_at=NULL
          WHERE tenant_id=$1 AND id=$2 AND status='pending' RETURNING ${OUTBOX_COLUMNS}`,
        [tenantId, candidate.id, randomUUID(), leaseMs])).rows[0];
        if (!message) throw new Error('Job claim returned no row');
        await client.query('INSERT INTO dripsign.outbox_claim(tenant_id,id,job_id) VALUES($1,$2,$3)', [tenantId, randomUUID(), message.id]);
        messages.push(message);
      }
      await client.query(`DELETE FROM dripsign.outbox_claim WHERE id IN
        (SELECT id FROM dripsign.outbox_claim WHERE tenant_id=$1 AND claimed_at<now()-interval '1 day'
          ORDER BY claimed_at,id LIMIT 1000)`, [tenantId]);
      return messages;
    });
  }

  private async context(client: PoolClient, fence: JobFence): Promise<OutboxContext> {
    await this.fence(client, fence);
    const message = (await client.query<OutboxMessage>(`SELECT ${OUTBOX_COLUMNS} FROM dripsign.outbox
      WHERE tenant_id=$1 AND id=$2`, [fence.tenantId, fence.id])).rows[0];
    if (!message) throw new StoreError('not_found', 'Resource not found');
    if (message.kind === 'invitation' || message.kind === 'otp') {
      const payload = parseMailJobPayload(message.payload);
      if (payload.expiresAt !== null && Date.parse(payload.expiresAt) <= Date.now()) throw new StoreError('conflict', 'Mail expired');
      if (message.kind === 'invitation') {
        const grant = await client.query(`SELECT 1 FROM dripsign.recipient_grant WHERE tenant_id=$1
          AND agreement_id=$2 AND email=$3 AND revoked_at IS NULL FOR SHARE`, [message.tenantId, message.agreementId, payload.email.to]);
        if (!grant.rowCount) throw new StoreError('not_found', 'Resource not found');
      } else {
        if (!message.dedupeKey.startsWith('otp:')) throw new StoreError('invalid', 'Challenge delivery is invalid');
        const challenge = await client.query(`SELECT 1 FROM dripsign.otp_challenge c WHERE c.id=$2
          AND (c.tenant_id=$1 OR c.tenant_id IS NULL) AND c.email=$3 AND c.consumed_at IS NULL
          AND c.expires_at>now() AND c.attempts<5 AND
          ((c.scope->>'kind'='staff' AND EXISTS(SELECT 1 FROM dripsign.staff_membership s
            WHERE s.tenant_id=$1 AND s.email=c.email AND s.revoked_at IS NULL))
          OR (c.scope->>'kind'='recipient' AND EXISTS(SELECT 1 FROM dripsign.recipient_grant g
            WHERE g.tenant_id=$1 AND g.email=c.email AND g.revoked_at IS NULL))) FOR SHARE OF c`,
        [message.tenantId, message.dedupeKey.slice(4), payload.email.to]);
        if (!challenge.rowCount) throw new StoreError('not_found', 'Resource not found');
      }
      return { message, detail: null, executedEvent: null, archiveEvidence: null };
    }
    if (message.kind === 'agreement_executed') return { message, detail: null, executedEvent: await this.executionEvent(client, message), archiveEvidence: null };
    if (message.kind === 'revision_published') {
      const grantId = message.payload['grantId'];
      if (typeof grantId !== 'string' || !message.agreementId) throw new StoreError('invalid', 'Revision notification is invalid');
      const grant = (await client.query<{ email: string }>(`SELECT email FROM dripsign.recipient_grant
        WHERE tenant_id=$1 AND agreement_id=$2 AND id=$3 AND revoked_at IS NULL`, [message.tenantId, message.agreementId, grantId])).rows[0];
      if (!grant) throw new StoreError('not_found', 'Resource not found');
      const detail = await this.detail(client, { kind: 'recipient', tenantId: message.tenantId, agreementId: message.agreementId, grantId, email: grant.email }, message.agreementId);
      if (detail.agreement.currentRevisionId !== message.payload['revisionId']) throw new StoreError('conflict', 'Revision notification changed');
      return { message, detail, executedEvent: null, archiveEvidence: null };
    }
    if (message.kind === 'archive') {
      if (!message.agreementId) throw new StoreError('invalid', 'Signing archive scope is invalid');
      const payload = parseArchiveJobPayload(message.payload);
      const archiveEvidence = await this.archiveEvidence(client, message.tenantId, message.agreementId, payload.roundId, payload.revisionId);
      return { message, detail: null, executedEvent: null, archiveEvidence };
    }
    if (message.kind === 'proposal_ai_suggestion') {
      await this.proposalSuggestionContext(client, fence, parseProposalAiJobPayload(message.payload), true);
      return { message, detail: null, executedEvent: null, archiveEvidence: null };
    }
    if (message.kind !== 'ai_suggestion' && message.kind !== 'pdf_prepare') throw new StoreError('invalid', 'Job kind is invalid');
    const command = jobMutation(message.payload['mutation']);
    if (command.actor.kind !== 'staff' || command.actor.tenantId !== fence.tenantId || command.agreementId !== message.agreementId) throw new StoreError('not_found', 'Resource not found');
    const detail = await this.detail(client, command.actor, command.agreementId);
    if (command.expectedVersion !== detail.agreement.version) throw new StoreError('conflict', 'Agreement changed; reload it');
    return { message, detail, executedEvent: null, archiveEvidence: null };
  }

  private async executionEvent(client: PoolClient, message: OutboxMessage): Promise<ExecutedAgreementEvent | null> {
    const round = (await client.query<{ id: string }>(`SELECT id FROM dripsign.signing_round
      WHERE tenant_id=$1 AND agreement_id=$2 AND status='completed' AND revision_id=$3`,
      [message.tenantId, message.agreementId, message.payload['revisionId']])).rows[0];
    if (!round) throw new StoreError('conflict', 'Completion event changed');
    if (!message.agreementId) throw new StoreError('conflict', 'Completion scope changed');
    const frozen=await freezeCompletionExport(client, message.tenantId, message.agreementId, round.id);
    if (frozen&&frozen.event.eventId!==message.id) throw new StoreError('conflict', 'Original completion event changed');
    return frozen;
  }

  private async completionStaff(client: PoolClient, actor: import('./types.ts').StaffActor, tokenHash: string): Promise<void> {
    await this.staff(client, actor);
    const live = await client.query(`SELECT 1 FROM dripsign.auth_session WHERE token_hash=$1
      AND revoked_at IS NULL AND expires_at>clock_timestamp() AND actor->>'kind'='staff'
      AND actor->>'tenantId'=$2 AND actor->>'userId'=$3 FOR SHARE`, [tokenHash, actor.tenantId, actor.userId]);
    if (!live.rowCount) throw new StoreError('not_found', 'Resource not found');
  }
  async readCompletionExportConfig(actor: import('./types.ts').StaffActor, tokenHash: string): Promise<{ revision: number; config: unknown | null }> {
    return transaction(this.pool, async (client) => {
      await this.completionStaff(client, actor, tokenHash);
      const row=(await client.query<{revision:string;config:unknown}>(`SELECT revision::text,config FROM dripsign.completion_export_config WHERE tenant_id=$1 ORDER BY revision DESC LIMIT 1`,[actor.tenantId])).rows[0];
      await this.completionStaff(client, actor, tokenHash);
      return {revision:Number(row?.revision??0),config:row?.config??null};
    });
  }
  async configureCompletionExport(actor: import('./types.ts').StaffActor, tokenHash: string,
    expected: number, config: CompletionExportConfig): Promise<number> {
    return transaction(this.pool, async (client) => {
      await this.completionStaff(client, actor, tokenHash);
      const revision = await configureCompletionExport(client, actor.tenantId, expected, config);
      await this.completionStaff(client, actor, tokenHash); return revision;
    });
  }
  async recoverCompletionExport(actor: import('./types.ts').StaffActor, tokenHash: string,
    agreement: string, round: string): Promise<string> {
    return transaction(this.pool, async (client) => {
      await this.completionStaff(client, actor, tokenHash);
      const event = await recoverCompletionExport(client, actor.tenantId, agreement, round);
      await this.completionStaff(client, actor, tokenHash); return event;
    });
  }

  async getOutboxContext(fence: JobFence): Promise<OutboxContext> {
    return transaction(this.pool, (client) => this.context(client, fence));
  }

  // The durable marker is committed before any external request; an ambiguous paid request cannot be dispatched again.
  async beginOutboxEffect(fence: JobFence): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      const { message } = await this.context(client, fence);
      if ((message.kind === 'ai_suggestion' || message.kind === 'proposal_ai_suggestion') && !(await client.query('SELECT 1 FROM dripsign.ai_reservation WHERE tenant_id=$1 AND job_id=$2', [fence.tenantId, fence.id])).rowCount) return false;
      const result = await client.query(`UPDATE dripsign.outbox SET effect_started_at=now()
        WHERE tenant_id=$1 AND id=$2 AND lease_token=$3 AND status='delivering'
        AND lease_until>now() AND effect_started_at IS NULL`, [fence.tenantId, fence.id, fence.leaseToken]);
      return result.rowCount === 1;
    });
  }

  async finishOutbox(fence: JobFence, status: 'delivered' | 'uncertain' | 'failed', receipt?: string): Promise<boolean> {
    if (!['delivered', 'uncertain', 'failed'].includes(status)) throw new StoreError('invalid', 'Job outcome is invalid');
    if (receipt !== undefined) bounded(receipt, 'Job receipt', 500);
    return transaction(this.pool, async (client) => {
      const result = await client.query<OutboxMessage>(`UPDATE dripsign.outbox SET status=$4,receipt=$5,lease_token=NULL,lease_until=NULL
        WHERE tenant_id=$1 AND id=$2 AND lease_token=$3 AND status='delivering' AND lease_until>now() RETURNING ${OUTBOX_COLUMNS}`,
      [fence.tenantId, fence.id, fence.leaseToken, status, receipt ?? null]);
      const message = result.rows[0];
      if (message && message.kind === 'proposal_ai_suggestion') await this.closeProposalCandidate(client, message, status === 'uncertain' ? 'uncertain' : 'failed');
      if (message && status === 'failed' && message.kind === 'pdf_prepare') await this.failPdfDraft(client, message, receipt?.slice(0, 100) ?? 'processing_failed');
      return result.rowCount === 1;
    });
  }

  private async failPdfDraft(client: PoolClient, message: OutboxMessage, reason: string): Promise<void> {
    const rawPayload: unknown = message.payload;
    if (typeof rawPayload !== 'object' || rawPayload === null || Array.isArray(rawPayload) || !('originalDocument' in rawPayload)) return;
    const original = rawPayload.originalDocument;
    // Terminal cleanup must work even when the stored mutation cannot pass current validation.
    // The persisted tenant/agreement and exact raw asset identify the failure target without granting any new authority.
    if (typeof original !== 'object' || original === null || Array.isArray(original)
      || !('objectKey' in original) || typeof original.objectKey !== 'string' || original.objectKey.length < 1 || original.objectKey.length > 1000
      || !('sha256' in original) || typeof original.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(original.sha256)) return;
    // Failure labels no longer attach parsed content; they may survive unrelated version changes for this exact raw asset.
    await client.query(`UPDATE dripsign.agreement SET version=version+1,
      draft=jsonb_set(jsonb_set(draft,'{preparationStatus}','"failed"'::jsonb),'{preparationError}',to_jsonb($5::text))
      WHERE tenant_id=$1 AND id=$2 AND draft->>'preparationStatus'='preparing'
      AND draft->'originalDocument'->>'objectKey'=$3 AND draft->'originalDocument'->>'sha256'=$4`,
    [message.tenantId, message.agreementId, original.objectKey, original.sha256, reason]);
  }

  private async closeProposalCandidate(client: PoolClient, message: OutboxMessage, status: 'failed' | 'uncertain'): Promise<void> {
    await client.query('UPDATE dripsign.proposal_ai_candidate SET status=$4 WHERE tenant_id=$1 AND agreement_id=$2 AND job_id=$3 AND status=\'queued\'',[message.tenantId,message.agreementId,message.id,status]);
  }

  async retryOutbox(fence: JobFence, retryAt: string, code: string): Promise<boolean> {
    bounded(code, 'Retry code', 100);
    const delay = Date.parse(retryAt)-Date.now();
    if (!Number.isFinite(delay) || delay < 0 || delay > 86_400_000) throw new StoreError('invalid', 'Retry time is invalid');
    return transaction(this.pool, async (client) => {
      const result = await client.query(`UPDATE dripsign.outbox SET status=CASE WHEN attempts<$6 THEN 'pending' ELSE 'failed' END,
        available_at=$4,receipt=$5,lease_token=NULL,lease_until=NULL,effect_started_at=NULL
        WHERE tenant_id=$1 AND id=$2 AND lease_token=$3 AND status='delivering'
        AND lease_until>now() AND kind=ANY($7::text[])`, [fence.tenantId, fence.id, fence.leaseToken, retryAt, code, MAX_ATTEMPTS, RETRY_KINDS]);
      return result.rowCount === 1;
    });
  }

  async enqueueOutbox(message: NewOutboxMessage): Promise<string> {
    return transaction(this.pool, (client) => this.enqueue(client, message));
  }

  async reserveAiBudget(reservation: AiReservation): Promise<boolean> {
    positiveInteger(reservation.maxCostMicros, AI_DAILY_LIMIT_MICROS);
    positiveInteger(reservation.dailyLimitMicros, AI_DAILY_LIMIT_MICROS);
    positiveInteger(reservation.perRunLimitMicros, AI_DAILY_LIMIT_MICROS);
    if (reservation.maxCostMicros > reservation.perRunLimitMicros || reservation.maxCostMicros > reservation.dailyLimitMicros) return false;
    return transaction(this.pool, async (client) => {
      const fence = { tenantId: reservation.tenantId, id: reservation.jobId, leaseToken: reservation.leaseToken };
      const { message } = await this.context(client, fence);
      if ((message.kind !== 'ai_suggestion' && message.kind !== 'proposal_ai_suggestion') || message.agreementId !== reservation.agreementId) throw new StoreError('invalid', 'AI reservation scope is invalid');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`dripsign:ai-admission:${reservation.tenantId}`]);
      const previous = (await client.query<{ reserved_micros: string; actual_micros: string | null }>('SELECT reserved_micros,actual_micros FROM dripsign.ai_reservation WHERE tenant_id=$1 AND job_id=$2', [reservation.tenantId, reservation.jobId])).rows[0];
      if (previous) return false;
      const spent = (await client.query<{ micros: string }>(`SELECT COALESCE(sum(COALESCE(actual_micros,reserved_micros)),0)::text AS micros
        FROM dripsign.ai_reservation WHERE tenant_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date`, [reservation.tenantId])).rows[0];
      if (!spent) throw new Error('AI admission count returned no row');
      if (BigInt(spent.micros)+BigInt(reservation.maxCostMicros) > BigInt(reservation.dailyLimitMicros)) return false;
      await client.query(`INSERT INTO dripsign.ai_reservation(tenant_id,agreement_id,job_id,day,reserved_micros)
        VALUES($1,$2,$3,(now() AT TIME ZONE 'UTC')::date,$4)`, [reservation.tenantId, reservation.agreementId, reservation.jobId, reservation.maxCostMicros]);
      return true;
    });
  }

  // Unknown AI outcomes retain their full reservation; only a known cost settles it under the current lease.
  async settleAiBudget(fence: JobFence, actualCostMicros: number): Promise<boolean> {
    if (!Number.isSafeInteger(actualCostMicros) || actualCostMicros < 0 || actualCostMicros > AI_DAILY_LIMIT_MICROS) throw new StoreError('invalid', 'AI cost is invalid');
    return transaction(this.pool, async (client) => {
      await this.fence(client, fence);
      const result = await client.query(`UPDATE dripsign.ai_reservation SET actual_micros=$3
        WHERE tenant_id=$1 AND job_id=$2 AND actual_micros IS NULL AND reserved_micros>=$3`, [fence.tenantId, fence.id, actualCostMicros]);
      return result.rowCount === 1;
    });
  }
}
