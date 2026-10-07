import { acceptUploadedPdfEnvelope } from '@dripsign/core';
import { idSchema, uploadHeaders } from '../../../../../../server/api';
import { bridgeActor } from '../../../../../../server/bridge';
import { getStorage } from '../../../../../../server/commands';
import { handleRequest, HttpError, json, readBytes, requireAdmission } from '../../../../../../server/http';
import { getStore } from '../../../../../../server/store';

export async function POST(request: Request, context: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  return handleRequest(async () => {
    requireAdmission();
    const id = idSchema.parse((await context.params).id);
    const bytes = await readBytes(request, 10 * 1024 * 1024);
    const actor = await bridgeActor(request, bytes, id, 'upload');
    const detail = await getStore().getAgreement(actor, id);
    if (!detail.allowedActions.includes('save_draft')) throw new HttpError(409, 'agreement_closed');
    if (request.headers.get('content-type') !== 'application/pdf') throw new HttpError(415, 'pdf_required');
    const query = new URL(request.url).searchParams;
    const input = uploadHeaders.parse({ expectedVersion: query.get('expectedVersion'), idempotencyKey: query.get('idempotencyKey') });
    acceptUploadedPdfEnvelope(bytes);
    const originalDocument = await getStorage().putRawPdfImmutable(actor.tenantId, id, bytes);
    const jobId = await getStore().queueUploadedPdf({ actor, agreementId: id, ...input }, originalDocument);
    return json({ jobId, preparationStatus: 'preparing' }, 202);
  });
}
