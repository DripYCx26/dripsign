import { acceptUploadedPdfEnvelope } from '@dripsign/core';
import { idSchema, uploadHeaders } from '../../../../../server/api';
import { getStorage } from '../../../../../server/commands';
import { handleRequest, HttpError, json, readBytes, requireOrigin, requireAdmission } from '../../../../../server/http';
import { requireActor } from '../../../../../server/sessions';
import { getStore } from '../../../../../server/store';

/** Store the bounded raw envelope and queue isolated parsing before it becomes publishable. */
export async function POST(request: Request, context: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  return handleRequest(async () => {
    requireAdmission();
    requireOrigin(request);
    const actor = await requireActor('staff');
    if (actor.kind !== 'staff') throw new HttpError(401, 'authentication_required');
    const id = idSchema.parse((await context.params).id);
    const detail = await getStore().getAgreement(actor, id);
    if (!detail.allowedActions.includes('save_draft')) throw new HttpError(409, 'agreement_closed');
    if (request.headers.get('content-type') !== 'application/pdf') throw new HttpError(415, 'pdf_required');
    const input = uploadHeaders.parse({ expectedVersion: request.headers.get('x-expected-version'), idempotencyKey: request.headers.get('idempotency-key') });
    const bytes = await readBytes(request, 10 * 1024 * 1024);
    acceptUploadedPdfEnvelope(bytes);
    const originalDocument = await getStorage().putRawPdfImmutable(actor.tenantId, id, bytes);
    const jobId = await getStore().queueUploadedPdf({ actor, agreementId: id, ...input }, originalDocument);
    return json({ jobId, preparationStatus: 'preparing' }, 202);
  });
}
