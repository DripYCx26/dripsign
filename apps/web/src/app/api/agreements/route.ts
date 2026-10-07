import { createSchema, createAgreement, idSchema } from '../../../server/api';
import { handleRequest, HttpError, json, readJson, requireOrigin } from '../../../server/http';
import { requireActor } from '../../../server/sessions';
import { listAgreements } from '../../../server/agreements';

export async function GET(request: Request): Promise<Response> {
  return handleRequest(async () => {
    const before = new URL(request.url).searchParams.get('before');
    return json({ agreements: await listAgreements(await requireActor(), before ? idSchema.parse(before) : null) });
  });
}
export async function POST(request: Request): Promise<Response> {
  return handleRequest(async () => {
    requireOrigin(request);
    const actor = await requireActor('staff');
    if (actor.kind !== 'staff') throw new HttpError(401, 'authentication_required');
    return json(await createAgreement(actor, await readJson(request, createSchema)), 201);
  });
}
