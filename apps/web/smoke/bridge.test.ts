// The staff session bridge over HTTP, with this test standing in for the host app: it signs
// assertions with a host key whose public half the running DripSign is configured with, posts them
// as the host's page does, and checks that only a valid, unused one for a listed staff member opens
// that member's staff workspace. It runs only when DRIPSIGN_SMOKE_BRIDGE_SEED names the key.
//
// DRIPSIGN_SMOKE_BRIDGE_SEED      64 hex: the host's Ed25519 seed (a local test key, never a real one)
// DRIPSIGN_SMOKE_BRIDGE_HOST      the host origin DripSign trusts (DRIPSIGN_BRIDGE_HOST_ORIGIN)
// DRIPSIGN_SMOKE_BRIDGE_TENANT    the staff member's tenant id
// DRIPSIGN_SMOKE_STAFF_EMAIL      that member's email
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign } from 'node:crypto';
import { test } from 'node:test';

const origin = new URL(process.env['DRIPSIGN_SMOKE_URL'] ?? 'https://localhost:8443').origin;
const seed = process.env['DRIPSIGN_SMOKE_BRIDGE_SEED'];
const host = process.env['DRIPSIGN_SMOKE_BRIDGE_HOST'] ?? '';
const tenant = process.env['DRIPSIGN_SMOKE_BRIDGE_TENANT'] ?? '';
const staffEmail = process.env['DRIPSIGN_SMOKE_STAFF_EMAIL'] ?? 'staff@example.com';

function keyFrom(hex: string) {
  return createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(hex, 'hex')]), format: 'der', type: 'pkcs8' });
}

/** One assertion as the host signs it; `claims` overrides the valid defaults. */
function assertion(claims: Record<string, unknown> = {}, signingSeed = seed ?? ''): string {
  const key = keyFrom(signingSeed);
  const raw = Buffer.from(createPublicKey(keyFrom(seed ?? '')).export({ format: 'jwk' }).x ?? '', 'base64url');
  const kid = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: host, aud: origin, sub: randomUUID(), firm: tenant, email: staffEmail, iat: now, exp: now + 60, jti: randomBytes(16).toString('base64url'), ...claims };
  const signed = `${Buffer.from(JSON.stringify({ alg: 'EdDSA', kid, typ: 'dripsign-staff+jwt' })).toString('base64url')}.${Buffer.from(JSON.stringify(body)).toString('base64url')}`;
  return `${signed}.${sign(null, Buffer.from(signed), key).toString('base64url')}`;
}

/** The host page's form post into its frame: the host's Origin, a form body, no redirect followed. */
async function enter(token: string, from = host): Promise<Response> {
  return fetch(new URL('/api/bridge/session', origin), {
    method: 'POST', redirect: 'manual', headers: { Origin: from, 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Dest': 'iframe' },
    body: new URLSearchParams({ assertion: token }).toString(),
  });
}

test('only a valid, unused assertion for a listed staff member opens that member\'s workspace', { skip: seed === undefined }, async () => {
  const token = assertion();
  const opened = await enter(token);
  assert.equal(opened.status, 303);
  assert.equal(opened.headers.get('location'), `${origin}/staff`);
  const cookie = opened.headers.getSetCookie().find((value) => value.startsWith('dripsign_bridge_session='));
  assert.ok(cookie, 'the bridge sets its own session cookie');
  assert.match(cookie, /; Secure/iu);
  assert.match(cookie, /; HttpOnly/iu);
  assert.match(cookie, /; SameSite=none/iu);
  assert.match(cookie, /; Partitioned/iu);
  const workspace = await fetch(new URL('/staff', origin), { headers: { Cookie: cookie.split(';')[0] ?? '', 'Sec-Fetch-Dest': 'iframe' } });
  const page = await workspace.text();
  assert.equal(workspace.status, 200);
  assert.match(page, /Agreement inbox/u);
  assert.doesNotMatch(page, /Sign out|Staff sign-in/u);
  assert.match(workspace.headers.get('content-security-policy') ?? '', new RegExp(`frame-ancestors ${host.replaceAll('.', '\\.')}$`, 'u'));
  assert.equal(workspace.headers.get('x-frame-options'), null);

  const [header, body, signature] = assertion().split('.') as [string, string, string];
  const refused = {
    replayed: await enter(token),
    forged: await enter(`${header}.${body}.${signature.slice(0, 10)}${signature[10] === 'A' ? 'B' : 'A'}${signature.slice(11)}`),
    'signed by another key': await enter(assertion({}, randomBytes(32).toString('hex'))),
    expired: await enter(assertion({ iat: Math.floor(Date.now() / 1000) - 200, exp: Math.floor(Date.now() / 1000) - 140 })),
    'not a staff member': await enter(assertion({ email: `nobody-${randomUUID()}@example.com` })),
    'another tenant': await enter(assertion({ firm: randomUUID() })),
  };
  for (const [reason, response] of Object.entries(refused)) {
    assert.equal(response.status, 401, reason);
    assert.equal(response.headers.getSetCookie().length, 0, reason);
  }
  assert.equal((await enter(assertion(), 'https://elsewhere.example')).status, 403);
  const framedSignedOut = await fetch(new URL('/staff', origin), { headers: { 'Sec-Fetch-Dest': 'iframe' } });
  assert.match(await framedSignedOut.text(), /Session ended/u);
});
