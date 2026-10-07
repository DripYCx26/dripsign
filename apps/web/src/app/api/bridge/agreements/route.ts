import { hashBytes } from '@dripsign/core';
import { createAgreement, createSchema, idSchema } from '../../../../server/api';
import { bridgeActor } from '../../../../server/bridge';
import { handleRequest, json, MAX_COMMAND_BYTES, readBytes, parseJsonBytes } from '../../../../server/http';
import { listAgreements } from '../../../../server/agreements';

/** Host list/create requests receive native tenant authorization after assertion verification. */
export async function GET(request: Request): Promise<Response> {
  return handleRequest(async () => {
    const actor = await bridgeActor(request, new Uint8Array(), 'agreements', 'list');
    const before = new URL(request.url).searchParams.get('before');
    return json({ agreements: await listAgreements(actor, before ? idSchema.parse(before) : null) });
  });
}
export async function POST(request: Request): Promise<Response> {
  return handleRequest(async () => {
    const bytes = await readBytes(request, MAX_COMMAND_BYTES);
    const actor = await bridgeActor(request, bytes, 'agreements', 'create');
    const input = parseJsonBytes(bytes, createSchema);
    return json(await createAgreement(actor, input, { tenantId: actor.tenantId, subject: actor.userId, idempotencyKey: input.idempotencyKey, bodySha256: hashBytes(bytes) }), 201);
  });
}
