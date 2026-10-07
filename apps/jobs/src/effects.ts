import {
  DocuSealClient, PrivateSuggestionClient, S3DocumentStorage, SesEmailClient,
  estimateSuggestionCostMicros, parseEmailMessage, prepareSigningDocument, suggestionCostMicros,
} from '@dripsign/core';
import {
  StoreError, parseAiJobPayload, parseMailJobPayload, parsePdfPreparationJobPayload, parseSigningJobPayload,
} from '@dripsign/db';
import type {
  AgreementDetail, DripSignStore, JobFence, OutboxMessage, OutboxStatus,
  ProviderSubmission, RecipientGrant, SigningJobPayload, SigningOutcome, SigningRequest,
} from '@dripsign/db';
import type { readConfiguration } from './config.ts';
import { deliverExecutedEvent } from './hostDelivery.ts';
import { logMetadata } from './metadataLog.ts';

const RETRY_KINDS = new Set<OutboxMessage['kind']>(['signing_reconcile', 'archive', 'agreement_executed']);
// ASSUMPTION: five reads with exponential backoff provide bounded recovery before staff attention.
const MAX_ATTEMPTS = 5;
// ASSUMPTION: pilot ceiling ratified by the service owner, counted conservatively after unknown outcomes.
const AI_DAILY_LIMIT_MICROS = 10_000_000;

function requireDetail(detail: AgreementDetail | null): AgreementDetail {
  if (!detail) throw new StoreError('not_found', 'Job agreement is unavailable');
  return detail;
}

function frozenSigners(detail: AgreementDetail): readonly RecipientGrant[] {
  const round = detail.signingRound;
  const revision = detail.revisions.find((item) => item.id === round?.revisionId);
  if (!round || !revision || revision.id !== detail.agreement.currentRevisionId
    || !round.requiredGrantIds.length || revision.requiredGrantIds.length !== round.requiredGrantIds.length
    || revision.requiredGrantIds.some((id) => !round.requiredGrantIds.includes(id))) {
    throw new StoreError('conflict', 'Signing revision changed');
  }
  const signers = round.requiredGrantIds.map((id) => detail.grants.find((grant) => grant.id === id));
  if (signers.some((grant) => !grant || !grant.requiredSigner || grant.revokedAt !== null)) {
    throw new StoreError('conflict', 'Required signers changed');
  }
  return signers.filter((grant): grant is RecipientGrant => grant !== undefined);
}

/** Executes only the persisted job kind; domain writes remain lease-fenced in the canonical store. */
export class JobEffects {
  private readonly store: DripSignStore;
  private readonly configuration: ReturnType<typeof readConfiguration>;
  private readonly email: SesEmailClient;
  private readonly signing: DocuSealClient;
  private readonly storage: S3DocumentStorage;
  private readonly suggestions: PrivateSuggestionClient;

  constructor(store: DripSignStore, configuration: ReturnType<typeof readConfiguration>) {
    this.store = store;
    this.configuration = configuration;
    this.email = new SesEmailClient(configuration.region, configuration.emailFrom);
    this.signing = new DocuSealClient(configuration.docusealUrl, configuration.docusealKey, configuration.artifactOrigins);
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
        case 'signing_create':
        case 'signing_reconcile':
          await this.observeSigning(fence, context.message, requireDetail(context.detail), begin);
          break;
        case 'signing_cancel':
          await this.cancelSigning(fence, context.message, requireDetail(context.detail), begin);
          break;
        case 'archive':
          await this.archive(fence, context.message, requireDetail(context.detail), begin);
          break;
        case 'pdf_prepare':
          await this.preparePdf(fence, context.message, requireDetail(context.detail), begin);
          break;
        case 'ai_suggestion':
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

  private async signingRequest(detail: AgreementDetail, payload: SigningJobPayload): Promise<SigningRequest> {
    const round = detail.signingRound;
    const revision = detail.revisions.find((item) => item.id === round?.revisionId);
    if (!round || round.id !== payload.roundId || !revision) throw new StoreError('conflict', 'Signing round changed');
    const signers = frozenSigners(detail);
    const pdf = await this.storage.get(detail.agreement.tenantId, detail.agreement.id, revision.document);
    return { attemptId: round.attemptId, title: detail.agreement.title, pdf, sha256: revision.document.sha256, signers, fields: revision.signingFields };
  }

  private async observeSigning(fence: JobFence, message: OutboxMessage, detail: AgreementDetail, begin: () => Promise<void>): Promise<void> {
    const payload = parseSigningJobPayload(message.payload);
    const round = detail.signingRound;
    if (!round || round.id !== payload.roundId) throw new StoreError('conflict', 'Signing round changed');
    const request = message.kind === 'signing_create' || !round.providerSubmissionId
      ? await this.signingRequest(detail, payload) : null;
    const signers = frozenSigners(detail);
    if (message.kind === 'signing_create' && (round.status !== 'preparing' || round.providerSubmissionId !== null)) {
      throw new StoreError('conflict', 'Signing creation was already attempted');
    }
    await begin();
    let outcome: SigningOutcome;
    if (message.kind === 'signing_create') {
      if (!request) throw new StoreError('conflict', 'Signing request is unavailable');
      outcome = await this.signing.create(request);
    } else if (round.providerSubmissionId) {
      outcome = { status: 'created', submission: await this.signing.read(round.providerSubmissionId, signers, round.attemptId) };
    } else {
      if (!request) throw new StoreError('conflict', 'Signing request is unavailable');
      outcome = await this.signing.reconcile(request);
    }
    if (outcome.status === 'rejected') {
      if (message.kind === 'signing_create') {
        await this.store.rejectSigningCreation(fence, payload.mutation, payload.roundId, outcome);
      }
      return this.finish(fence, 'failed', outcome.code);
    }
    if (outcome.status === 'uncertain') {
      if (message.kind === 'signing_create') {
        await this.store.markSigningUncertain(payload.mutation, payload.roundId, fence);
        return this.finish(fence, 'uncertain');
      }
      return this.retry(fence, message, 'signing_lookup_pending');
    }
    if (outcome.submission.status === 'expired') {
      await this.store.applySigningCancellation(fence, payload.mutation, payload.roundId, outcome.submission);
      return this.finish(fence, 'delivered', outcome.submission.id);
    }
    if (outcome.submission.status === 'declined' || outcome.submission.status === 'archived') {
      return this.finish(fence, 'uncertain', 'provider_signing_closed');
    }
    await this.store.applySigningObservation(fence, payload.mutation, payload.roundId, outcome.submission);
    if (message.kind === 'signing_reconcile' && outcome.submission.status === 'pending') {
      return this.retry(fence, message, 'signing_pending');
    }
    await this.finish(fence, 'delivered', outcome.submission.id);
  }

  private async cancelSigning(fence: JobFence, message: OutboxMessage, detail: AgreementDetail, begin: () => Promise<void>): Promise<void> {
    const payload = parseSigningJobPayload(message.payload);
    const round = detail.signingRound;
    if (!round || round.id !== payload.roundId) throw new StoreError('conflict', 'Signing round changed');
    const signers = frozenSigners(detail);
    const request = round.providerSubmissionId ? null : await this.signingRequest(detail, payload);
    await begin();
    let observed: ProviderSubmission;
    if (round.providerSubmissionId) observed = await this.signing.read(round.providerSubmissionId, signers, round.attemptId);
    else {
      if (!request) throw new StoreError('conflict', 'Signing request is unavailable');
      const recovered = await this.signing.reconcile(request);
      if (recovered.status !== 'created') {
        await this.store.markCancellationUncertain(fence, payload);
        return this.finish(fence, 'uncertain', 'cancellation_lookup_pending');
      }
      observed = recovered.submission;
      if (observed.status === 'pending' || observed.status === 'completed') {
        await this.store.applySigningObservation(fence, payload.mutation, payload.roundId, observed);
      }
    }
    const outcome = observed.status === 'expired' ? 'cancelled' : observed.status === 'completed' ? 'uncertain'
      : await this.signing.cancel(observed.id, signers);
    if (outcome === 'uncertain') {
      await this.store.markCancellationUncertain(fence, payload);
      return this.finish(fence, 'uncertain', 'cancellation_pending');
    }
    const evidence = observed.status === 'expired' ? observed : await this.signing.read(observed.id, signers, round.attemptId);
    if (evidence.status !== 'expired') {
      await this.store.markCancellationUncertain(fence, payload);
      return this.finish(fence, 'uncertain', 'cancellation_pending');
    }
    await this.store.applySigningCancellation(fence, payload.mutation, payload.roundId, evidence);
    await this.finish(fence, 'delivered');
  }

  private async archive(fence: JobFence, message: OutboxMessage, detail: AgreementDetail, begin: () => Promise<void>): Promise<void> {
    const payload = parseSigningJobPayload(message.payload);
    const round = detail.signingRound;
    if (!round || round.id !== payload.roundId || !round.providerSubmissionId) throw new StoreError('conflict', 'Signing round changed');
    await begin();
    const submission: ProviderSubmission = await this.signing.read(round.providerSubmissionId, frozenSigners(detail), round.attemptId);
    if (submission.status !== 'completed' || !submission.signedDocumentUrl || !submission.auditRecordUrl) {
      return this.retry(fence, message, 'archive_not_ready');
    }
    const signedBytes = await this.signing.downloadArtifact(submission.signedDocumentUrl);
    const signedDocument = await this.storage.putImmutable(message.tenantId, detail.agreement.id, 'signed_document', signedBytes);
    const auditBytes = await this.signing.downloadArtifact(submission.auditRecordUrl);
    const auditRecord = await this.storage.putImmutable(message.tenantId, detail.agreement.id, 'audit_record', auditBytes);
    await this.store.applyArchivedEvidence(fence, payload.mutation, {
      roundId: round.id, revisionId: round.revisionId, signedDocument, auditRecord,
    });
    await this.finish(fence, 'delivered');
  }

  private async suggest(fence: JobFence, message: OutboxMessage, begin: () => Promise<void>): Promise<void> {
    const payload = parseAiJobPayload(message.payload);
    const maxCostMicros = estimateSuggestionCostMicros();
    const reserved = await this.store.reserveAiBudget({
      tenantId: message.tenantId, agreementId: payload.mutation.agreementId, jobId: message.id, leaseToken: fence.leaseToken,
      maxCostMicros, dailyLimitMicros: AI_DAILY_LIMIT_MICROS, perRunLimitMicros: maxCostMicros,
    });
    if (!reserved) return this.finish(fence, 'failed', 'ai_budget_exhausted');
    await begin();
    const outcome = await this.suggestions.suggest({ source: payload.source, instruction: payload.instruction });
    if (outcome.status !== 'suggested') return this.finish(fence, outcome.status === 'uncertain' ? 'uncertain' : 'failed', outcome.code);
    const actualCost = suggestionCostMicros(outcome.inputTokens, outcome.outputTokens);
    if (actualCost > maxCostMicros) throw new Error('AI reported usage above its reserved ceiling');
    if (!await this.store.settleAiBudget(fence, actualCost)) throw new StoreError('conflict', 'AI reservation changed');
    await this.store.recordPrivateAiMessage(payload.mutation, 'assistant', JSON.stringify(outcome.suggestion), fence);
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
