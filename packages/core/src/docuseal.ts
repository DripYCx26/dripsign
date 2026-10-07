import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { StoreError } from '@dripsign/db';
import type { ProviderEvent, ProviderSigner, ProviderSubmission, RecipientGrant, SigningField, SigningOutcome, SigningRequest } from '@dripsign/db';
import { hashBytes, validateUploadedPdf } from './documents.ts';
import { configuredHttpsUrl, readBoundedBody, readProviderJson } from './providerHttp.ts';

const providerId = z.number().int().positive().safe();
const signerWireSchema = z.object({
  id: providerId, submission_id: providerId, email: z.email().max(254),
  role: z.string().min(1).max(128), external_id: z.string().min(1).max(256),
  slug: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  completed_at: z.iso.datetime({ offset: true }).nullable(),
  status: z.enum(['completed', 'declined', 'opened', 'sent', 'awaiting']),
  embed_src: z.url().optional(),
});
const submissionWireSchema = z.object({
  id: providerId, status: z.enum(['pending', 'completed', 'declined', 'expired']),
  archived_at: z.iso.datetime({ offset: true }).nullable().optional(),
  submitters: z.array(signerWireSchema).min(1).max(10),
  audit_log_url: z.url().nullable().optional(),
  documents: z.array(z.object({ url: z.url() })).max(10).optional(),
});
const fieldSchema: z.ZodType<SigningField> = z.strictObject({
  grantId: z.uuid(), type: z.enum(['signature', 'date', 'text']), page: z.number().int().min(1).max(200),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1),
}).refine(field => field.x + field.width <= 1 && field.y + field.height <= 1);
const fieldsSchema = z.array(fieldSchema).min(1).max(100);
const requestSchema: z.ZodType<SigningRequest> = z.strictObject({
  attemptId: z.uuid(), title: z.string().min(1).max(200), pdf: z.instanceof(Uint8Array), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  signers: z.array(z.strictObject({
    id: z.uuid(), agreementId: z.uuid(), email: z.email().max(254), name: z.string().min(1).max(200),
    requiredSigner: z.literal(true), revokedAt: z.null(),
  })).min(1).max(10),
  fields: fieldsSchema,
});

export function parseSigningFields(value: unknown): readonly SigningField[] {
  const parsed = fieldsSchema.safeParse(value);
  if (!parsed.success) throw new StoreError('invalid', 'The signing fields are invalid.');
  return parsed.data;
}

/** Provider side effects have no automatic retry; the durable attempt must exist before create is called. */
export class DocuSealClient {
  private readonly base: URL;
  private readonly apiKey: string;
  private readonly artifactOrigins: ReadonlySet<string>;

  constructor(baseUrl: string, apiKey: string, artifactOrigins: readonly string[]) {
    this.base = configuredHttpsUrl(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (!apiKey) throw new Error('DocuSeal credentials are missing.');
    this.apiKey = apiKey;
    this.artifactOrigins = new Set(artifactOrigins.map(origin => configuredHttpsUrl(origin).origin));
    if (!this.artifactOrigins.size) throw new Error('DocuSeal artifact origins are missing.');
  }

  private async request(path: string, method = 'GET', body?: unknown): Promise<Response> {
    return fetch(new URL(path, this.base), {
      method, headers: { 'X-Auth-Token': this.apiKey, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
  }

  private artifactUrl(value: string): string {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !this.artifactOrigins.has(url.origin)) {
      throw new Error('DocuSeal returned an unsupported document origin.');
    }
    return url.href;
  }

  private signer(value: z.infer<typeof signerWireSchema>, expected: readonly RecipientGrant[], attemptId?: string): ProviderSigner {
    const grant = expected.find(item => item.id === value.role);
    if (!grant || !grant.requiredSigner || grant.revokedAt || value.email.toLowerCase() !== grant.email.toLowerCase()
      || value.external_id !== `${attemptId ?? value.external_id.split(':')[0]}:${grant.id}`) {
      throw new Error('DocuSeal signer identities do not match the request.');
    }
    const signingUrl = value.embed_src ?? new URL(`s/${value.slug}`, this.base.origin === 'https://api.docuseal.com' ? 'https://docuseal.com/' : this.base).href;
    return { grantId: grant.id, providerId: String(value.id), email: grant.email, role: grant.id,
      signingUrl: this.artifactUrl(signingUrl), completedAt: value.status === 'completed' ? value.completed_at : null };
  }

  private submission(value: unknown, expected: readonly RecipientGrant[], attemptId?: string): ProviderSubmission {
    const wire = submissionWireSchema.parse(value);
    const signers = wire.submitters.map(item => this.signer(item, expected, attemptId));
    if (signers.length !== expected.length || new Set(signers.map(item => item.grantId)).size !== expected.length
      || wire.submitters.some(item => item.submission_id !== wire.id)) throw new Error('DocuSeal returned an unexpected signer set.');
    if (wire.status === 'completed' && signers.some(item => !item.completedAt)) throw new Error('DocuSeal completion is incomplete.');
    if (wire.documents && wire.documents.length > 1) throw new Error('DocuSeal returned multiple signed documents.');
    const document = wire.documents?.[0]?.url;
    return { id: String(wire.id), status: wire.archived_at ? 'archived' : wire.status, signers,
      signedDocumentUrl: document ? this.artifactUrl(document) : null,
      auditRecordUrl: wire.audit_log_url ? this.artifactUrl(wire.audit_log_url) : null };
  }

  async create(value: SigningRequest): Promise<SigningOutcome> {
    const parsed = requestSchema.safeParse(value);
    if (!parsed.success) return { status: 'rejected', code: 'invalid_request' };
    const request = parsed.data;
    if (hashBytes(request.pdf) !== request.sha256) return { status: 'rejected', code: 'document_hash_mismatch' };
    const pageCount = await validateUploadedPdf(request.pdf);
    const grantIds = new Set(request.signers.map(item => item.id));
    if (grantIds.size !== request.signers.length || new Set(request.signers.map(item => item.email.toLowerCase())).size !== request.signers.length
      || new Set(request.signers.map(item => item.agreementId)).size !== 1
      || request.fields.some(field => !grantIds.has(field.grantId) || field.page > pageCount || field.x + field.width > 1 || field.y + field.height > 1)
      || request.signers.some(signer => !request.fields.some(field => field.grantId === signer.id && field.type === 'signature'))) {
      return { status: 'rejected', code: 'invalid_signer_fields' };
    }
    try {
      const response = await this.request('submissions/pdf', 'POST', {
        name: request.title, send_email: false, send_sms: false, order: 'random', remove_tags: false,
        documents: [{ name: request.title, file: Buffer.from(request.pdf).toString('base64'), fields: request.fields.map((field, index) => ({
          name: `${field.type}-${index}`, type: field.type, role: field.grantId, required: true,
          areas: [{ page: field.page, x: field.x, y: field.y, w: field.width, h: field.height }],
        })) }],
        submitters: request.signers.map(signer => ({ name: signer.name, email: signer.email, role: signer.id,
          external_id: `${request.attemptId}:${signer.id}`, send_email: false, send_sms: false })),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return response.status >= 400 && response.status < 500 && response.status !== 408
          ? { status: 'rejected', code: `provider_${response.status}` } : { status: 'uncertain' };
      }
      const created = z.object({ id: providerId }).parse(await readProviderJson(response));
      return { status: 'created', submission: await this.read(String(created.id), request.signers, request.attemptId) };
    } catch (error: unknown) { return { status: 'uncertain' }; }
  }

  /** A missing lookup remains uncertain; it never authorizes another provider creation. */
  async reconcile(request: SigningRequest): Promise<SigningOutcome> {
    const parsed = requestSchema.safeParse(request);
    if (!parsed.success) return { status: 'rejected', code: 'invalid_request' };
    const first = request.signers[0];
    if (!first) return { status: 'rejected', code: 'invalid_request' };
    try {
      const response = await this.request(`submitters?external_id=${encodeURIComponent(`${request.attemptId}:${first.id}`)}&limit=2`);
      if (!response.ok) { await response.body?.cancel(); return { status: 'uncertain' }; }
      const body = z.object({ data: z.array(signerWireSchema).max(2) }).parse(await readProviderJson(response));
      const found = body.data[0];
      if (body.data.length !== 1 || !found) return { status: 'uncertain' };
      this.signer(found, request.signers, request.attemptId);
      return { status: 'created', submission: await this.read(String(found.submission_id), request.signers, request.attemptId) };
    } catch (error: unknown) { return { status: 'uncertain' }; }
  }

  async read(id: string, expected: readonly RecipientGrant[], attemptId?: string): Promise<ProviderSubmission> {
    if (!/^\d{1,16}$/u.test(id)) throw new Error('DocuSeal submission identifier is invalid.');
    const response = await this.request(`submissions/${id}`);
    if (!response.ok) { await response.body?.cancel(); throw new Error('DocuSeal submission could not be read.'); }
    const submission = this.submission(await readProviderJson(response), expected, attemptId);
    if (submission.id !== id) throw new Error('DocuSeal returned a different submission.');
    return submission;
  }

  /** Confirms expiration on a subsequent read; archival alone is not proof that signing stopped. */
  async cancel(id: string, expected: readonly RecipientGrant[]): Promise<'cancelled' | 'uncertain'> {
    if (!/^\d{1,16}$/u.test(id)) return 'uncertain';
    try {
      const response = await this.request(`submissions/${id}`, 'PUT', { expire_at: '2000-01-01 00:00:00 UTC' });
      if (!response.ok) { await response.body?.cancel(); return 'uncertain'; }
      await readProviderJson(response);
      const submission = await this.read(id, expected);
      return submission.status === 'expired' ? 'cancelled' : 'uncertain';
    } catch (error: unknown) { return 'uncertain'; }
  }

  async downloadArtifact(url: string): Promise<Uint8Array> {
    const response = await fetch(this.artifactUrl(url), { signal: AbortSignal.timeout(30_000), redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); throw new Error('DocuSeal artifact could not be read.'); }
    const bytes = await readBoundedBody(response, 20 * 1024 * 1024);
    await validateUploadedPdf(bytes, 20 * 1024 * 1024);
    return bytes;
  }
}

/** Authenticates the timestamp and raw bytes; persistence owns replay deduplication and authoritative reconciliation. */
export function parseDocuSealWebhook(raw: Uint8Array, signature: string, secret: string, now: Date): ProviderEvent {
  if (!secret || !Number.isFinite(now.getTime()) || raw.length > 256 * 1024 || !/^\d{1,12}\.[a-f0-9]{64}$/u.test(signature)) throw new StoreError('forbidden', 'The webhook could not be verified.');
  const [timestamp, digest] = signature.split('.');
  if (!timestamp || !digest || Math.abs(now.getTime() / 1000 - Number(timestamp)) > 300) throw new StoreError('forbidden', 'The webhook could not be verified.');
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(digest, 'hex'))) throw new StoreError('forbidden', 'The webhook could not be verified.');
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as unknown; }
  catch (error: unknown) { throw new StoreError('invalid', 'The webhook event is invalid.'); }
  const event = z.object({
    event_type: z.enum(['submission.created', 'submission.completed', 'submission.expired', 'submission.archived', 'form.viewed', 'form.started', 'form.completed', 'form.declined']),
    timestamp: z.iso.datetime({ offset: true }),
    data: z.object({ id: providerId, submission_id: providerId.optional(), submission: z.object({ id: providerId }).optional() }),
  }).safeParse(payload);
  if (!event.success) throw new StoreError('invalid', 'The webhook event is invalid.');
  const { event_type: kind, data, timestamp: occurredAt } = event.data;
  const submissionId = kind.startsWith('submission.') ? data.id : data.submission_id ?? data.submission?.id;
  if (!submissionId) throw new StoreError('invalid', 'The webhook event is invalid.');
  return { eventId: hashBytes(raw), submissionId: String(submissionId), occurredAt,
    kind: kind === 'submission.completed' ? 'completed' : kind === 'submission.expired' ? 'expired'
      : kind === 'submission.archived' ? 'archived' : kind === 'form.declined' ? 'declined' : 'changed' };
}
