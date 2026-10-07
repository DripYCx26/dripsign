import { z } from 'zod';
import { bridgeActor } from '../../../../../server/bridge';
import { handleRequest, HttpError, json, MAX_COMMAND_BYTES, parseJsonBytes, readBytes } from '../../../../../server/http';
import { getStore } from '../../../../../server/store';

const schema = z.strictObject({ subject: z.string().min(1).max(200), idempotencyKey: z.string().min(8).max(200), bodySha256: z.string().regex(/^[a-f0-9]{64}$/) });

/** Recover only agreement metadata bound to the exact original host creation request. */
export async function POST(request: Request): Promise<Response> {
  return handleRequest(async () => {
    const bytes = await readBytes(request, MAX_COMMAND_BYTES);
    const actor = await bridgeActor(request, bytes, 'agreements', 'recover_create');
    const input = parseJsonBytes(bytes, schema);
    const agreement = await getStore().getBridgeCreatedAgreement(actor, input.subject, input.idempotencyKey, input.bodySha256);
    if (!agreement) throw new HttpError(404, 'not_found');
    return json(agreement);
  });
}
