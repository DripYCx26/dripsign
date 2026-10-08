import 'server-only';
import { z } from 'zod';
import type { Actor, StaffActor, CreateProvenance } from '@dripsign/db';
import { documentSourceSchema } from '@dripsign/core';
import { getStore } from './store';
import { getStorage } from './commands';
import { HttpError, requireAdmission, apiResponseHeaders } from './http';
import { getConfiguration } from './config';

export const idSchema = z.uuid();
export const createSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(200), title: z.string().min(1).max(200),
  source: documentSourceSchema.nullable(),
  recipients: z.array(z.strictObject({ email: z.email().max(320), name: z.string().min(1).max(200), requiredSigner: z.boolean() })).min(1).max(10),
});
export const uploadHeaders = z.strictObject({ expectedVersion: z.coerce.number().int().min(1), idempotencyKey: z.string().min(8).max(200) });
export const artifactSchema = z.enum(['document', 'draft', 'signed_document', 'audit_record']);

export async function createAgreement(actor: StaffActor, input: z.infer<typeof createSchema>, createProvenance: CreateProvenance | null = null): Promise<unknown> {
  requireAdmission();
  return getStore().createAgreement({ actor, idempotencyKey: input.idempotencyKey, title: input.title,
    createProvenance, draft: { source: input.source, document: null, originalDocument: null, preparationStatus: 'empty', preparationError: null, signingFields: [], requiredGrantIds: [] }, recipients: input.recipients });
}

/** Select assets from an authorized projection, never from a browser-provided object key. */
export async function downloadPdf(actor: Actor, agreementId: string, kind: z.infer<typeof artifactSchema>): Promise<Response> {
  const detail = await getStore().getAgreement(actor, agreementId);
  const asset = kind === 'draft' ? detail.draft?.document
    : kind === 'document' ? detail.revisions.find((revision) => revision.id === detail.agreement.currentRevisionId)?.document
    : detail.artifacts.find((artifact) => artifact.kind === kind)?.document;
  if (!asset || (kind === 'draft' && actor.kind !== 'staff')) throw new HttpError(404, 'not_found');
  const bytes = await getStorage().get(actor.tenantId, agreementId, asset);
  await getStore().getAgreement(actor, agreementId);
  const host = getConfiguration().staffBridge?.hostOrigin;
  return new Response(Buffer.from(bytes), { headers: {
    ...apiResponseHeaders(),
    'Content-Type': 'application/pdf', 'Content-Length': String(bytes.byteLength),
    'Content-Disposition': `${kind === 'document' || kind === 'draft' ? 'inline' : 'attachment'}; filename="${kind}.pdf"`,
    'X-Content-Type-Options': 'nosniff',
    // The staff workspace shows this PDF in its own frame, which a configured host app may frame in turn.
    ...(host ? { 'Content-Security-Policy': `sandbox; default-src 'none'; frame-ancestors 'self' ${host}` }
      : { 'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN' }),
  } });
}
