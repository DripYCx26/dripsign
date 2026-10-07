import { idSchema } from '../../../../../server/api';
import { bridgeActor } from '../../../../../server/bridge';
import { handleRequest, json } from '../../../../../server/http';
import { getStore } from '../../../../../server/store';

export async function GET(request: Request, context: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  return handleRequest(async () => {
    const id = idSchema.parse((await context.params).id);
    return json(await getStore().getAgreement(await bridgeActor(request, new Uint8Array(), id, 'read'), id));
  });
}
