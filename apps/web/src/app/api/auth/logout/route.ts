import { cookies } from 'next/headers';
import { getConfiguration } from '../../../../server/config';
import { handleRequest, requireOrigin } from '../../../../server/http';
import { getStore } from '../../../../server/store';
import { SESSION_COOKIE, CHALLENGE_COOKIE, cookieSettings, hashToken } from '../../../../server/sessions';

/** Revoke the native session before clearing its browser cookie. */
export async function POST(request: Request): Promise<Response> {
  return handleRequest(async () => {
    requireOrigin(request);
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (token) await getStore().revokeSession(hashToken(token));
    cookieStore.set(SESSION_COOKIE, '', cookieSettings(0));
    cookieStore.set(CHALLENGE_COOKIE, '', cookieSettings(0));
    return Response.redirect(`${getConfiguration().publicOrigin}/`, 303);
  });
}
