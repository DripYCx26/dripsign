import { getStore } from '../../../../server/store';
import { requireSession } from '../../../../server/sessions';
import { handleRequest, HttpError, json, readBytes, requireOrigin } from '../../../../server/http';
import { parseCompletionExportConfig } from '@dripsign/db';
/** Own original staff session reads only the admitted public export configuration. */
export async function GET(): Promise<Response> {
  return handleRequest(async () => {
    const { session, tokenHash } = await requireSession('staff');
    if (session.actor.kind !== 'staff') throw new HttpError(401, 'authentication_required');
    return json(await getStore().readCompletionExportConfig(session.actor, tokenHash));
  });
}
/** Explicit versioned configuration; the signed completion body cannot choose a destination URL. */
export async function POST(request: Request): Promise<Response> {
  return handleRequest(async () => {
    requireOrigin(request);
    const { session, tokenHash } = await requireSession('staff');
    if (session.actor.kind !== 'staff') throw new HttpError(401, 'authentication_required');
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(request, 4096))) as unknown; }
    catch { throw new HttpError(400, 'invalid_request'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_request');
    const fields = value as Record<string, unknown>;
    if (Object.keys(fields).sort().join(',') !== 'config,expectedRevision' || typeof fields['expectedRevision'] !== 'number') {
      throw new HttpError(400, 'invalid_request');
    }
    const config = parseCompletionExportConfig(fields['config']);
    const revision = await getStore().configureCompletionExport(session.actor, tokenHash, fields['expectedRevision'], config);
    return json({ revision });
  });
}
