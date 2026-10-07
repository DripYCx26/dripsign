import { parseDocuSealWebhook } from '@dripsign/core';
import { handleRequest, HttpError, json, readBytes } from '../../../../server/http';
import { getStore } from '../../../../server/store';

/** Verified callbacks only enqueue reconciliation; no webhook alone proves execution. */
export async function POST(request: Request): Promise<Response> {
  return handleRequest(async () => {
    const secret = process.env.DOCUSEAL_WEBHOOK_SECRET;
    if (!secret) throw new HttpError(503, 'webhook_unavailable');
    const bytes = await readBytes(request, 256 * 1024);
    const event = parseDocuSealWebhook(bytes, request.headers.get('x-docuseal-signature') ?? '', secret, new Date());
    await getStore().ingestProviderEvent(event);
    return json({ accepted: true }, 202);
  });
}
