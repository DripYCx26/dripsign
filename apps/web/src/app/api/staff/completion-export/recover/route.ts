import { getStore } from '../../../../../server/store';
import { requireSession } from '../../../../../server/sessions';
import { handleRequest, HttpError, json, readBytes, requireOrigin } from '../../../../../server/http';
/** Requeues the original completed round's event, never a replacement agreement or execution. */
export async function POST(request: Request): Promise<Response> {
  return handleRequest(async () => {
    requireOrigin(request);
    const { session, tokenHash } = await requireSession('staff');
    if (session.actor.kind !== 'staff') throw new HttpError(401, 'authentication_required');
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(request, 1024))) as unknown; }
    catch { throw new HttpError(400, 'invalid_request'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_request');
    const fields = value as Record<string, unknown>;
    const id = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
    if (Object.keys(fields).sort().join(',') !== 'agreementId,roundId' || typeof fields['agreementId'] !== 'string'
      || typeof fields['roundId'] !== 'string' || !id.test(fields['agreementId']) || !id.test(fields['roundId'])) {
      throw new HttpError(400, 'invalid_request');
    }
    return json({ eventId: await getStore().recoverCompletionExport(session.actor, tokenHash, fields['agreementId'], fields['roundId']) });
  });
}
