import { artifactSchema, downloadPdf, idSchema } from '../../../../../server/api';
import { handleRequest } from '../../../../../server/http';
import { requireActor } from '../../../../../server/sessions';
import { agreementActor } from '../../../../../server/agreements';

export async function GET(request: Request, context: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  return handleRequest(async () => {
    const id = idSchema.parse((await context.params).id);
    const actor = await agreementActor(await requireActor(), id);
    return downloadPdf(actor, id, artifactSchema.parse(new URL(request.url).searchParams.get('kind') ?? 'document'));
  });
}
