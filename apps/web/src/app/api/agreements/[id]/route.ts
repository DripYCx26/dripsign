import { idSchema } from '../../../../server/api';
import { handleRequest, json } from '../../../../server/http';
import { requireActor } from '../../../../server/sessions';
import { getAgreement } from '../../../../server/agreements';

export async function GET(_request: Request, context: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  return handleRequest(async () => json(await getAgreement(await requireActor(), idSchema.parse((await context.params).id))));
}
