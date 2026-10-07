import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import type { AuthScope } from '@dripsign/db';
import { getConfiguration } from '../../../../server/config';
import { handleRequest, json, readJson, requireOrigin, requireAdmission } from '../../../../server/http';
import { getStore } from '../../../../server/store';
import { CHALLENGE_COOKIE, cookieSettings, hashToken, hashCode } from '../../../../server/sessions';

const schema = z.strictObject({ email: z.email().max(320), kind: z.enum(['staff', 'recipient']), agreementId: z.uuid().optional() });

/** Only existing staff memberships or live recipient grants can receive a sign-in code. */
export async function POST(request: Request): Promise<Response> {
  return handleRequest(async () => {
    requireOrigin(request);
    requireAdmission();
    const input = await readJson(request, schema);
    const email = input.email.trim().toLowerCase();
    const store = getStore();
    const membership = getConfiguration().staffMemberships.find((entry) => entry.email.toLowerCase() === email);
    const challengeId = randomUUID();
    const challengeToken = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const challengeScope: AuthScope = input.kind === 'recipient'
      ? { kind: 'recipient', email }
      : { kind: 'staff', tenantId: membership?.tenantId ?? randomUUID(), email };
    const code = randomInt(100000, 1000000).toString();
    await store.issueOtpChallenge({ id: challengeId, scope: challengeScope, challengeTokenHash: hashToken(challengeToken), codeHash: hashCode(challengeId, code), expiresAt: new Date(expiresAt).toISOString() }, {
        to: email, subject: 'Your DripSign sign-in code',
        text: `Hello,\n\nYour DripSign code is ${code}. It expires in 10 minutes.\n\nIf you did not request this code, you can ignore this email.\n\nDripSign`,
    });
    (await cookies()).set(CHALLENGE_COOKIE, challengeToken, cookieSettings(10 * 60));
    return json({ challengeId, message: 'If this email has access, a code is on its way.' }, 202);
  });
}
