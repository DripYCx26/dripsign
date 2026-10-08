import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { test } from 'node:test';
import { hostKey, verifyStaffAssertion } from './staffAssertion.ts';
import type { BridgeTrust } from './staffAssertion.ts';

// A host's test key: the Ed25519 seed is 32 bytes of 7. The token below was signed by the host's
// own implementation with this seed, so this test also proves the two implementations agree.
const SEED = Buffer.alloc(32, 7);
const PUBLIC_KEY = 'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';
const HOST_TOKEN = 'eyJhbGciOiJFZERTQSIsImtpZCI6ImZlODEyYzEyZjNhYjRjZTYiLCJ0eXAiOiJkcmlwc2lnbi1zdGFmZitqd3QifQ'
  + '.eyJpc3MiOiJodHRwczovL2FwcC5leGFtcGxlLnRlc3QiLCJhdWQiOiJodHRwczovL3NpZ24uZXhhbXBsZS50ZXN0Iiwic3ViIjoiMDE5OGI4MDItZGMwYi03MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwiZmlybSI6IjAxOThiODAyLWRjMGItNzAwMC04MDAwLTAwMDAwMDAwMDAwMiIsImVtYWlsIjoic3RhZmZAZXhhbXBsZS50ZXN0IiwiaWF0IjoxNzkwODI4MDAwLCJleHAiOjE3OTA4MjgwNjAsImp0aSI6IkFBRUNBd1FGQmdjSUNRb0xEQTBPRHcifQ'
  + '.yz5fovvWHe-9gTrUv1oE85inrlMx3V7S7PI6nYGqHCzGbs4U5rEPgMYmuQt8mkfFrgp1_dYRGCz0B069Ws-qDw';
const ISSUED = 1_790_828_000;
const TRUST: BridgeTrust = { hostOrigin: 'https://app.example.test', audience: 'https://sign.example.test', keys: [hostKey(PUBLIC_KEY)] };
const CLAIMS = {
  iss: 'https://app.example.test', aud: 'https://sign.example.test', sub: '0198b802-dc0b-7000-8000-000000000001',
  firm: '0198b802-dc0b-7000-8000-000000000002', email: 'staff@example.test', iat: ISSUED, exp: ISSUED + 60,
  jti: 'AAECAwQFBgcICQoLDA0ODw',
};

function privateKey(seed: Buffer) {
  return createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
}

/** Sign `claims` under `header` the way a host does; the test double for the host app. */
function mint(claims: object, seed = SEED, header: object = { alg: 'EdDSA', kid: hostKey(PUBLIC_KEY).id, typ: 'dripsign-staff+jwt' }): string {
  const signed = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return `${signed}.${sign(null, Buffer.from(signed), privateKey(seed)).toString('base64url')}`;
}

test('the host implementation and this one agree on the key, its id and a valid assertion', () => {
  const derived = Buffer.from(createPublicKey(privateKey(SEED)).export({ format: 'jwk' }).x ?? '', 'base64url').toString('hex');
  assert.equal(derived, PUBLIC_KEY);
  assert.equal(mint(CLAIMS), HOST_TOKEN);
  assert.deepEqual(verifyStaffAssertion(HOST_TOKEN, TRUST, ISSUED + 1), {
    subject: CLAIMS.sub, tenantId: CLAIMS.firm, email: CLAIMS.email, nonce: CLAIMS.jti, expiresAt: ISSUED + 60,
  });
});

test('a forged assertion opens nothing', () => {
  const [header, body, signature] = HOST_TOKEN.split('.') as [string, string, string];
  const otherSeed = Buffer.alloc(32, 9);
  const forged = [
    `${header}.${body}.${signature.slice(0, 10)}${signature[10] === 'A' ? 'B' : 'A'}${signature.slice(11)}`,
    `${header}.${Buffer.from(JSON.stringify({ ...CLAIMS, email: 'other@example.test' })).toString('base64url')}.${signature}`,
    mint(CLAIMS, otherSeed),
    mint(CLAIMS, SEED, { alg: 'none', kid: hostKey(PUBLIC_KEY).id, typ: 'dripsign-staff+jwt' }),
    mint(CLAIMS, SEED, { alg: 'EdDSA', kid: hostKey(PUBLIC_KEY).id, typ: 'JWT' }),
    mint({ ...CLAIMS, role: 'owner' }),
    `${header}.${body}`,
    `${header}.${body}.${signature}.${signature}`,
    'not a token',
    `${HOST_TOKEN}${'A'.repeat(2048)}`,
  ];
  for (const token of forged) assert.equal(verifyStaffAssertion(token, TRUST, ISSUED + 1), null);
  const rotated: BridgeTrust = { ...TRUST, keys: [hostKey(Buffer.from(createPublicKey(privateKey(otherSeed)).export({ format: 'jwk' }).x ?? '', 'base64url').toString('hex'))] };
  assert.equal(verifyStaffAssertion(HOST_TOKEN, rotated, ISSUED + 1), null);
});

test('an expired, early, overlong or misaddressed assertion opens nothing', () => {
  assert.equal(verifyStaffAssertion(HOST_TOKEN, TRUST, ISSUED + 60), null);
  assert.equal(verifyStaffAssertion(HOST_TOKEN, TRUST, ISSUED + 3600), null);
  assert.equal(verifyStaffAssertion(HOST_TOKEN, TRUST, ISSUED - 6), null);
  assert.notEqual(verifyStaffAssertion(HOST_TOKEN, TRUST, ISSUED - 5), null);
  assert.equal(verifyStaffAssertion(mint({ ...CLAIMS, exp: ISSUED + 121 }), TRUST, ISSUED + 1), null);
  assert.notEqual(verifyStaffAssertion(mint({ ...CLAIMS, exp: ISSUED + 120 }), TRUST, ISSUED + 1), null);
  assert.equal(verifyStaffAssertion(HOST_TOKEN, { ...TRUST, hostOrigin: 'https://other.example.test' }, ISSUED + 1), null);
  assert.equal(verifyStaffAssertion(HOST_TOKEN, { ...TRUST, audience: 'https://other.example.test' }, ISSUED + 1), null);
});
