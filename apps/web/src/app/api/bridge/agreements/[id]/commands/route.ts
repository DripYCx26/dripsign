import { idSchema } from '../../../../../../server/api';
import { bridgeActor } from '../../../../../../server/bridge';
import { commandSchema, executeCommand } from '../../../../../../server/commands';
import { handleRequest, json, MAX_COMMAND_BYTES, readBytes, parseJsonBytes } from '../../../../../../server/http';

export async function POST(request: Request, context: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  return handleRequest(async () => {
    const id = idSchema.parse((await context.params).id);
    const bytes = await readBytes(request, MAX_COMMAND_BYTES);
    const input = parseJsonBytes(bytes, commandSchema);
    const actor = await bridgeActor(request, bytes, id, input.action);
    return json(await executeCommand(actor, id, input));
  });
}
