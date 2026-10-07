import { idSchema } from '../../../../../server/api';
import { commandSchema, executeCommand } from '../../../../../server/commands';
import { handleRequest, json, readJson, requireOrigin } from '../../../../../server/http';
import { requireActor } from '../../../../../server/sessions';
import { agreementActor } from '../../../../../server/agreements';

export async function POST(request: Request, context: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  return handleRequest(async () => {
    requireOrigin(request);
    const id = idSchema.parse((await context.params).id);
    const actor = await agreementActor(await requireActor(), id);
    return json(await executeCommand(actor, id, await readJson(request, commandSchema)));
  });
}
