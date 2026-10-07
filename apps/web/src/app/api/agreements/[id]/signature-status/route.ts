import { idSchema } from '../../../../../server/api';
import { handleRequest, json } from '../../../../../server/http';
import { requireActor } from '../../../../../server/sessions';
import { getAgreement } from '../../../../../server/agreements';

/** Report only confirmed local signing and archival evidence; reads never create submissions. */
export async function GET(_request: Request, context: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  return handleRequest(async () => {
    const detail = await getAgreement(await requireActor(), idSchema.parse((await context.params).id));
    return json({ status: detail.agreement.status, round: detail.signingRound, signatures: detail.signatures, artifacts: detail.artifacts });
  });
}
