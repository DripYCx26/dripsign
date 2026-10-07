import {
  PrivateSuggestionClient, S3DocumentStorage, SesEmailClient,
  estimateSuggestionCostMicros, parseEmailMessage, prepareSigningDocument, renderExecutedArtifacts, suggestionCostMicros,
} from '@dripsign/core';
import {
  StoreError, parseAiJobPayload, parseArchiveJobPayload, parseMailJobPayload,
  parsePdfPreparationJobPayload, parseProposalAiJobPayload,
} from '@dripsign/db';
import type {
  AgreementDetail, DripSignStore, JobFence, OutboxMessage, OutboxStatus,
  RecipientGrant, SigningArchiveEvidence,
} from '@dripsign/db';
import type { readConfiguration } from './config.ts';
import { deliverExecutedEvent } from './hostDelivery.ts';
import { logMetadata } from './metadataLog.ts';

const RETRY_KINDS = new Set<OutboxMessage['kind']>(['archive', 'agreement_executed']);
// ASSUMPTION: five idempotent attempts with exponential backoff provide bounded recovery before staff attention.
const MAX_ATTEMPTS = 5;
// ASSUMPTION: pilot ceiling ratified by the service owner, counted conservatively after unknown outcomes.
const AI_DAILY_LIMIT_MICROS = 10_000_000;

function requireDetail(detail: AgreementDetail | null): AgreementDetail {
  if (!detail) throw new StoreError('not_found', 'Job agreement is unavailable');
  return detail;
}

/** Executes only the persisted job kind; domain writes remain lease-fenced in the canonical store. */
export class JobEffects {
  private readonly store: DripSignStore;
  private readonly configuration: ReturnType<typeof readConfiguration>;
  private readonly email: SesEmailClient;
  private readonly storage: S3DocumentStorage;
  private readonly suggestions: PrivateSuggestionClient;

  constructor(store: DripSignStore, configuration: ReturnType<typeof readConfiguration>) {
    this.store = store;
    this.configuration = configuration;
    this.email = new SesEmailClient(configuration.region, configuration.emailFrom);
    this.storage = new S3DocumentStorage(configuration.region, configuration.bucket, configuration.kmsKeyId);
    this.suggestions = new PrivateSuggestionClient(configuration.anthropicKey);
  }

  async dispatch(message: OutboxMessage): Promise<void> {
    if (!message.leaseToken) throw new Error('Claimed job has no fencing token');
    const fence: JobFence = { tenantId: message.tenantId, id: message.id, leaseToken: message.leaseToken };
    const startedAt = Date.now();
    let dispatched = false;
    const begin = async (): Promise<void> => {
      if (!await this.store.beginOutboxEffect(fence)) {
        dispatched = true;
        throw new StoreError('conflict', 'Job effect was already dispatched');
      }
      dispatched = true;
    };
    try {
      const context = await this.store.getOutboxContext(fence);
      switch (message.kind) {
        case 'otp':
        case 'invitation': {
          const payload = parseMailJobPayload(context.message.payload);
          if (payload.expiresAt !== null && Date.parse(payload.expiresAt) <= Date.now()) {
            await this.finish(fence, 'failed', 'mail_expired');
            break;
          }
          await this.sendMail(fence, parseEmailMessage(payload.email), begin);
          break;
        }
        case 'revision_published': {
          const detail = requireDetail(context.detail);
          const grantId = context.message.payload['grantId'];
          const revisionId = context.message.payload['revisionId'];
          if (Object.keys(context.message.payload).some((key) => key !== 'grantId' && key !== 'revisionId')
            || typeof grantId !== 'string' || typeof revisionId !== 'string') {
            throw new StoreError('invalid', 'Revision notification is invalid');
          }
          const grant = detail.grants.find((item) => item.id === grantId && item.revokedAt === null);
          if (!grant || detail.agreement.currentRevisionId !== revisionId) throw new StoreError('conflict', 'Revision notification changed');
          const link = new URL(`/agreements/${encodeURIComponent(detail.agreement.id)}`, this.configuration.publicOrigin).href;
          await this.sendMail(fence, parseEmailMessage({
            to: grant.email, subject: 'An agreement is ready for review',
            text: `Hello ${grant.name},\n\nA new version of ${detail.agreement.title} is ready for review.\n\n${link}\n\nDripSign`,
          }), begin);
          break;
        }
        case 'archive':
          await this.archive(fence, context.message, context.archiveEvidence, begin);
          break;
        case 'pdf_prepare':
          await this.preparePdf(fence, context.message, requireDetail(context.detail), begin);
          break;
        case 'ai_suggestion':
        case 'proposal_ai_suggestion':
          await this.suggest(fence, context.message, begin);
          break;
        case 'agreement_executed': {
          if (!context.executedEvent) throw new StoreError('conflict', 'Execution evidence is unavailable');
          await begin();
          const outcome = await deliverExecutedEvent(this.configuration.hostEventUrl, this.configuration.hostEventSecret, context.executedEvent);
          if (outcome === 'retry') await this.retry(fence, message, 'host_delivery_pending');
          else await this.finish(fence, outcome);
          break;
        }
        default: {
          const exhaustive: never = message.kind;
          throw new Error(`Unsupported job kind: ${exhaustive}`);
        }
      }
    } catch (error: unknown) {
      const code = error instanceof StoreError ? error.code : 'provider_io';
      logMetadata({ event: 'failure', jobId: message.id, kind: message.kind, code });
      if (RETRY_KINDS.has(message.kind) && !(error instanceof StoreError)) await this.retry(fence, message, code);
      else await this.finish(fence, dispatched ? 'uncertain' : 'failed', code);
    }
    logMetadata({ event: 'finished', jobId: message.id, kind: message.kind, elapsedMs: Date.now() - startedAt });
  }

  private async finish(fence: JobFence, status: Extract<OutboxStatus, 'delivered' | 'uncertain' | 'failed'>, receipt?: string): Promise<void> {
    const committed = await this.store.finishOutbox(fence, status, receipt);
    if (!committed) logMetadata({ event: 'fenced', jobId: fence.id });
  }

  private async retry(fence: JobFence, message: OutboxMessage, code: string): Promise<void> {
    if (message.attempts >= MAX_ATTEMPTS) return this.finish(fence, 'uncertain', code);
    const retryAt = new Date(Date.now() + Math.min(30_000 * 2 ** (message.attempts - 1), 15 * 60_000)).toISOString();
    const committed = await this.store.retryOutbox(fence, retryAt, code);
    if (!committed) logMetadata({ event: 'fenced', jobId: fence.id });
  }

  private async sendMail(fence: JobFence, email: Parameters<SesEmailClient['send']>[0], begin: () => Promise<void>): Promise<void> {
    await begin();
    const outcome = await this.email.send(email);
    if (outcome.status === 'accepted') await this.finish(fence, 'delivered', outcome.messageId);
    else await this.finish(fence, outcome.status === 'rejected' ? 'failed' : 'uncertain', outcome.status === 'rejected' ? outcome.code : undefined);
  }

  private async archive(fence: JobFence, message: OutboxMessage, evidence: SigningArchiveEvidence | null, begin: () => Promise<void>): Promise<void> {
    const payload = parseArchiveJobPayload(message.payload);
    if (!evidence || !message.agreementId) throw new StoreError('conflict', 'Signing evidence is unavailable');
    const { revision, round, signatures, title } = evidence;
    if (round.id !== payload.roundId || revision.id !== payload.revisionId || round.revisionId !== revision.id
      || round.agreementId !== message.agreementId || revision.agreementId !== message.agreementId
      || revision.document.sha256 !== round.documentSha256
      || (round.status !== 'finalizing' && round.status !== 'completed')) {
      throw new StoreError('conflict', 'Signing evidence changed');
    }
    await begin();
    // Storage verifies the exact issued bytes; rendering uses frozen identities and signatures, never live grants.
    const pdf = await this.storage.get(message.tenantId, message.agreementId, revision.document);
    const artifacts = await renderExecutedArtifacts({ title, pdf, round, signatures, fields: revision.signingFields });
    const signedDocument = await this.storage.putImmutable(message.tenantId, message.agreementId, 'signed_document', artifacts.signedPdf);
    const auditRecord = await this.storage.putImmutable(message.tenantId, message.agreementId, 'audit_record', artifacts.auditPdf);
    await this.store.applyArchivedEvidence(fence, { roundId: round.id, revisionId: revision.id, signedDocument, auditRecord });
    await this.finish(fence, 'delivered');
  }

  private async suggest(fence: JobFence, message: OutboxMessage, begin: () => Promise<void>): Promise<void> {
    const payload = message.kind === 'proposal_ai_suggestion'
      ? parseProposalAiJobPayload(message.payload) : parseAiJobPayload(message.payload);
    if (!message.agreementId) throw new StoreError('invalid', 'AI agreement is unavailable');
    const finishSuggestion = async (status: 'failed' | 'uncertain', code: string): Promise<void> => {
      if ('proposalId' in payload) await this.store.failProposalSuggestion(fence, payload, status);
      await this.finish(fence, status, code);
    };
    const maxCostMicros = estimateSuggestionCostMicros();
    const reserved = await this.store.reserveAiBudget({
      tenantId: message.tenantId, agreementId: message.agreementId, jobId: message.id, leaseToken: fence.leaseToken,
      maxCostMicros, dailyLimitMicros: AI_DAILY_LIMIT_MICROS, perRunLimitMicros: maxCostMicros,
    });
    if (!reserved) return finishSuggestion('failed', 'ai_budget_exhausted');
    await begin();
    const outcome = await this.suggestions.suggest({ source: payload.source, instruction: payload.instruction });
    if (outcome.status !== 'suggested') return finishSuggestion(outcome.status, outcome.code);
    const actualCost = suggestionCostMicros(outcome.inputTokens, outcome.outputTokens);
    if (actualCost > maxCostMicros) throw new Error('AI reported usage above its reserved ceiling');
    if (!await this.store.settleAiBudget(fence, actualCost)) throw new StoreError('conflict', 'AI reservation changed');
    if ('proposalId' in payload) await this.store.completeProposalSuggestion(fence, payload, outcome.suggestion);
    else await this.store.recordPrivateAiMessage(payload.mutation, 'assistant', JSON.stringify(outcome.suggestion), fence);
    await this.finish(fence, 'delivered');
  }

  private async preparePdf(fence: JobFence, message: OutboxMessage, detail: AgreementDetail, begin: () => Promise<void>): Promise<void> {
    const payload = parsePdfPreparationJobPayload(message.payload);
    try {
      const signers = payload.requiredGrantIds.map((id) => detail.grants.find((grant) => grant.id === id && grant.requiredSigner && grant.revokedAt === null));
      if (!signers.length || signers.some((grant) => !grant)) throw new StoreError('conflict', 'Required signers changed');
      await begin();
      const originalBytes = await this.storage.get(message.tenantId, detail.agreement.id, payload.originalDocument);
      const prepared = await prepareSigningDocument(originalBytes, signers.filter((grant): grant is RecipientGrant => grant !== undefined));
      const document = await this.storage.putImmutable(message.tenantId, detail.agreement.id, 'draft', prepared.pdf);
      await this.store.completePdfPreparation(fence, payload, { document, signingFields: prepared.fields, requiredGrantIds: payload.requiredGrantIds });
      await this.finish(fence, 'delivered');
    } catch (error: unknown) {
      const code = error instanceof StoreError ? error.code : 'pdf_processing_failed';
      await this.store.failPdfPreparation(fence, payload, code);
      await this.finish(fence, 'failed', code);
      logMetadata({ event: 'failure', jobId: message.id, kind: message.kind, code });
    }
  }
}
