import { randomUUID } from 'node:crypto';
import { assertNativeSignatureNameRenderable } from '@dripsign/core';
import { SIGNING_VERIFICATION_MAX_AGE_MS } from '@dripsign/db';
import type { SignatureRequestEvidence } from '@dripsign/db';
import { z } from 'zod';
import { idSchema } from '../../../../../server/api';
import { handleRequest, HttpError, json, readJson, requireOrigin, requireAdmission } from '../../../../../server/http';
import { requireSession } from '../../../../../server/sessions';
import { agreementActor } from '../../../../../server/agreements';
import { getStore } from '../../../../../server/store';
import { SIGNING_CONSENT_VERSION, SIGNING_CONSENT_HASH } from '../../../../../signingConsent';

const schema = z.strictObject({
  expectedVersion: z.number().int().min(1), idempotencyKey: z.string().min(8).max(200),
  roundId: z.uuid(), revisionId: z.uuid(), documentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  typedName: z.string().trim().min(1).max(200), consentVersion: z.literal(SIGNING_CONSENT_VERSION),
  consentHash: z.literal(SIGNING_CONSENT_HASH), consentAccepted: z.literal(true),
});

/** Record a native signature against the frozen revision and return its durable public receipt. */
export async function POST(request: Request, context: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  return handleRequest(async () => {
    requireAdmission();
    requireOrigin(request);
    const id = idSchema.parse((await context.params).id);
    const { session, tokenHash } = await requireSession('recipient');
    const actor = await agreementActor(session.actor, id);
    if (actor.kind !== 'recipient') throw new HttpError(401, 'authentication_required');
    const verifiedAt = Date.parse(session.verifiedAt);
    const age = Date.now() - verifiedAt;
    if (!Number.isFinite(verifiedAt) || age < 0 || age > SIGNING_VERIFICATION_MAX_AGE_MS) throw new HttpError(401, 'verification_required');
    const input = await readJson(request, schema);
    await assertNativeSignatureNameRenderable(input.typedName);
    const evidence: SignatureRequestEvidence = {
      // No configured trusted proxy chain proves a browser's forwarded address.
      ipAddress: null, userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null, requestId: randomUUID(),
    };
    const signature = await getStore().signAgreement({ actor, agreementId: id, expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey }, input, tokenHash, evidence);
    return json({ roundId: signature.roundId, grantId: signature.grantId, typedName: signature.typedName,
      signedAt: signature.signedAt, revisionId: input.revisionId, documentSha256: signature.documentSha256 });
  });
}
