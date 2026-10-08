import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import type { AuthSession } from '@dripsign/db';
import { getConfiguration } from '../../../../server/config';
import { readBytes } from '../../../../server/http';
import { BRIDGE_SESSION_SECONDS, BRIDGE_SESSION_COOKIE, bridgeCookieSettings, hashToken } from '../../../../server/sessions';
import { verifyStaffAssertion } from '../../../../server/staffAssertion';
import { getStore } from '../../../../server/store';

// ASSUMPTION: a form body with one assertion is under 4 KiB.
const MAX_FORM_BYTES = 4096;

/** The page a refused entry shows inside the host's frame: fixed words, no detail. */
function refused(status: number): Response {
  const body = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>DripSign</title></head>'
    + '<body><main><h1>Session not opened</h1><p>This sign-in could not be opened. Reload the page that opened it.</p></main></body></html>';
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}

/**
 * A host app posts one signed staff assertion here from its own page into a frame. A valid,
 * unused assertion for a current staff member opens that member's staff session in a cookie the
 * browser keeps only inside that host page; anything else opens nothing.
 */
export async function POST(request: Request): Promise<Response> {
  const bridge = getConfiguration().staffBridge;
  if (!bridge) return new Response(null, { status: 404 });
  if (request.headers.get('origin') !== bridge.hostOrigin) return refused(403);
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') return refused(415);
  let assertion: string | null;
  try {
    const form = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(request, MAX_FORM_BYTES)));
    assertion = [...form.keys()].length === 1 && form.getAll('assertion').length === 1 ? form.get('assertion') : null;
  } catch { return refused(400); }
  const claims = assertion ? verifyStaffAssertion(assertion, bridge, Math.floor(Date.now() / 1000)) : null;
  if (!claims) return refused(401);
  const token = randomBytes(32).toString('base64url');
  let session: AuthSession | null;
  try {
    session = await getStore().openBridgeSession({
      issuer: bridge.hostOrigin, nonce: claims.nonce, subject: claims.subject, tenantId: claims.tenantId,
      email: claims.email, assertionExpiresAt: new Date(claims.expiresAt * 1000).toISOString(),
      sessionTokenHash: hashToken(token), sessionExpiresAt: new Date(Date.now() + BRIDGE_SESSION_SECONDS * 1000).toISOString(),
    });
  } catch (error: unknown) {
    process.stderr.write(JSON.stringify({ event: 'bridge_session_failed', errorClass: error instanceof Error ? error.name : 'Unknown' }) + '\n');
    return refused(503);
  }
  if (!session) return refused(401);
  (await cookies()).set(BRIDGE_SESSION_COOKIE, token, bridgeCookieSettings());
  return new Response(null, { status: 303, headers: { Location: `${getConfiguration().publicOrigin}/staff`, 'Cache-Control': 'private, no-store' } });
}
