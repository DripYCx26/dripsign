import { createSchema, createAgreement } from '../../../server/api';
import { handleRequest, HttpError, json, readJson, requireOrigin } from '../../../server/http';
import { requireActor } from '../../../server/sessions';
import { agreementListQuery, listAgreements } from '../../../server/agreements';

export async function GET(request: Request): Promise<Response> {
  return handleRequest(async () => {
    const actor = await requireActor();
    const query = agreementListQuery(request);
    return json({ agreements: await listAgreements(actor, query.before ?? null, query.view) });
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
