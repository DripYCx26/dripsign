import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { handleRequest, HttpError, json, readJson, requireOrigin } from '../../../../server/http';
import { getStore } from '../../../../server/store';
import { CHALLENGE_COOKIE, SESSION_COOKIE, SESSION_SECONDS, cookieSettings, hashCode, hashToken } from '../../../../server/sessions';

const schema = z.strictObject({ challengeId: z.uuid(), code: z.string().regex(/^[0-9]{6}$/) });

/** Code attempts are consumed transactionally; session credentials stay in an HttpOnly cookie. */
export async function POST(request: Request): Promise<Response> {
  return handleRequest(async () => {
    requireOrigin(request);
    const input = await readJson(request, schema);
    const cookieStore = await cookies();
    const challengeToken = cookieStore.get(CHALLENGE_COOKIE)?.value;
    if (!challengeToken || !/^[A-Za-z0-9_-]{43}$/.test(challengeToken)) throw new HttpError(401, 'authentication_required');
    const token = randomBytes(32).toString('base64url');
    const session = await getStore().consumeOtpChallenge({
      challengeId: input.challengeId, challengeTokenHash: hashToken(challengeToken), codeHash: hashCode(input.challengeId, input.code),
      sessionTokenHash: hashToken(token), sessionExpiresAt: new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(),
    });
    if (!session) throw new HttpError(401, 'authentication_required');
    cookieStore.set(SESSION_COOKIE, token, cookieSettings(SESSION_SECONDS));
    cookieStore.set(CHALLENGE_COOKIE, '', cookieSettings(0));
    return json({ authenticated: true });
  });
}
