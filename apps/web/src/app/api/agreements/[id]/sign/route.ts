import { createHash } from 'node:crypto';
import { z } from 'zod';
import { idSchema } from '../../../../../server/api';
import { handleRequest, HttpError, json, readJson, requireOrigin, requireAdmission } from '../../../../../server/http';
import { requireActor } from '../../../../../server/sessions';
import { agreementActor } from '../../../../../server/agreements';
import { getStore } from '../../../../../server/store';
import { SIGNING_CONSENT } from '../../../../../signingConsent';

const schema = z.strictObject({ expectedVersion: z.number().int().min(1), idempotencyKey: z.string().min(8).max(200), revisionId: z.uuid(), documentSha256: z.string().regex(/^[a-f0-9]{64}$/), intentConfirmed: z.literal(true) });

/** Record explicit consent to the exact frozen revision before exposing this recipient's signing URL. */
export async function POST(request: Request, context: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  return handleRequest(async () => {
    requireAdmission();
    requireOrigin(request);
    const id = idSchema.parse((await context.params).id);
    const actor = await agreementActor(await requireActor('recipient'), id);
    if (actor.kind !== 'recipient') throw new HttpError(401, 'authentication_required');
    const input = await readJson(request, schema);
    const consentHash = createHash('sha256').update(JSON.stringify({ consent: SIGNING_CONSENT, revisionId: input.revisionId, documentSha256: input.documentSha256, email: actor.email })).digest('hex');
    const access = await getStore().getSignerAccess({ actor, agreementId: id, expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey }, input.revisionId, input.documentSha256, consentHash);
    const url = new URL(access.signingUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new HttpError(503, 'signing_unavailable');
    return json({ signingUrl: url.href, revisionId: access.revisionId });
  });
}
