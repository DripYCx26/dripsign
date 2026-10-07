import { artifactSchema, downloadPdf, idSchema } from '../../../../../../server/api';
import { bridgeActor } from '../../../../../../server/bridge';
import { handleRequest } from '../../../../../../server/http';

export async function GET(request: Request, context: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  return handleRequest(async () => {
    const id = idSchema.parse((await context.params).id);
    const actor = await bridgeActor(request, new Uint8Array(), id, 'download');
    return downloadPdf(actor, id, artifactSchema.parse(new URL(request.url).searchParams.get('kind') ?? 'document'));
  });
}
