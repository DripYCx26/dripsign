// SOURCE proof for two real services and a disposable database. Execution belongs to root/DRE-217.
// No substituted completion state, artifact hash, crypto verifier or provider acknowledgment.
import assert from 'node:assert/strict';
import { createPublicKey, randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import { createPool } from '@dripsign/db';
import { Browser, nativeJourney } from './nativeJourney.ts';
import { retainedCompletion } from '../../../packages/db/test/completionExportProof.ts';
import { completionKeys, deliverCompletion, completionFrame } from '../../jobs/src/completionDelivery.ts';

function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`Missing proof configuration: ${name}`); return value; }
test('actual DripSign completed archives become one private reported Dreach citation', async () => {
  const origin = new URL(required('DREACH_COMPLETION_PROOF_ORIGIN')).origin;
  const tenant = required('DREACH_COMPLETION_PROOF_TENANT');
  const cookie = required('DREACH_COMPLETION_PROOF_COOKIE');
  const issuer = new URL(process.env['DRIPSIGN_SMOKE_URL'] ?? 'https://localhost:8443').origin;
  const keys = completionKeys(required('DRIPSIGN_COMPLETION_PROOF_KEYS'));
  const key = keys[0]; assert.ok(key);
  const publicKey = createPublicKey(key.privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const sourceTenant = required('DRIPSIGN_COMPLETION_PROOF_TENANT');
  const headers = { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin', Cookie: cookie, 'Dreach-Firm': tenant };
  async function dreach(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(new URL(path, origin), { method, headers: { ...headers, 'Idempotency-Key': randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, `Dreach ${method} ${path} must pass its actual authority boundary`);
    return await response.json() as Record<string, unknown>;
  }
  const pool = createPool(required('DRIPSIGN_COMPLETION_PROOF_DATABASE_URL'));
  try {
    const name = (await pool.query<{ name: string }>('SELECT current_database() AS name')).rows[0]?.name;
    assert.ok(name?.startsWith('dripsign_completion_proof_'), 'proof must target a disposable source database before any writes');
  const enrolled = await dreach('POST', '/v1/commands/enroll_external_signing_sender', {
    sourceTenantId: sourceTenant, issuer, audience: origin, keyId: key.keyId, keyVersion: key.keyVersion,
    publicKeyHex: publicKey, existingGrantId: null, days: 1,
  });
  const sender = await dreach('GET', `/v1/signing/external-sender?id=${String(enrolled['id'])}`);
  assert.equal(sender['revoked'], false);
  const staff = new Browser();
  await staff.signIn(process.env['DRIPSIGN_SMOKE_STAFF_EMAIL'] ?? 'staff@example.com', 'staff');
  const current = await staff.json('GET', '/api/staff/completion-export');
  assert.equal(current['revision'], 0, 'historical recovery proof needs a fresh unconfigured source tenant');
  // Complete the real ceremony before export configuration; the durable source event/time survives.
  const finished = await nativeJourney();
  await staff.json('POST', '/api/staff/completion-export', { expectedRevision: current['revision'], config: {
    tenantId: tenant, issuer, audience: origin, keyId: key.keyId, keyVersion: key.keyVersion,
    senderBindingId: sender['senderBindingId'], senderBindingRevision: sender['senderBindingRevision'],
    senderGrantId: sender['senderGrantId'], freshnessSeconds: 300,
  } });
  const recovered = await staff.json('POST', '/api/staff/completion-export/recover', {agreementId:finished.agreementId,roundId:finished.roundId});
  assert.ok(recovered['eventId']);
    const frozen = await retainedCompletion(pool, finished.agreementId, finished.roundId);
    const url = new URL('/v1/webhooks/dripsign', origin);
    const now = BigInt(Date.now()) * 1000n;
    const answers = await Promise.all([deliverCompletion(url, keys, frozen, now, issuer),
      deliverCompletion(url, keys, frozen, now + 1n, issuer)]);
    assert.equal(answers[0]?.status, 'delivered'); assert.equal(answers[1]?.status, 'delivered');
    assert.deepEqual(answers[0], answers[1], 'actual concurrent replay returns one original evidence identity');
    const list = await dreach('GET', '/v1/signing/external-evidence?limit=100');
    const items = list['items']; assert.ok(Array.isArray(items));
    const actual = items.filter((item: Record<string, unknown>) => item['agreementId'] === finished.agreementId);
    assert.equal(actual.length, 1);
    assert.equal(actual[0]['eventId'], frozen.event.eventId); assert.equal(actual[0]['revisionId'], finished.revisionId);
    assert.equal(actual[0]['roundId'], finished.roundId); assert.equal(actual[0]['basis'], 'provider_reported');
    assert.equal(actual[0]['state'], 'observed');
    assert.equal(actual[0]['completedAtMicros'], frozen.event.completedAtMicros);
    assert.equal(actual[0]['signedDocumentSha256'], frozen.event.signedDocumentSha256);
    assert.equal(actual[0]['auditRecordSha256'], frozen.event.auditRecordSha256);
    const id = actual[0]['id'];
    // The actual admitted jobs process must finish the original source outbox delivery.
    // Direct concurrent transport above does not supply or fabricate this durable worker receipt.
    const deadline=Date.now()+30_000;
    for (;;) {
      const message=(await pool.query<{status:string;receipt:string|null}>(
        'SELECT status,receipt FROM dripsign.outbox WHERE tenant_id=$1 AND id=$2',
        [sourceTenant,frozen.event.eventId])).rows[0];
      assert.ok(message,'original source outbox remains retained');
      if(message.status==='delivered') {
        assert.equal(message.receipt,`external_evidence:${String(id)}`);break;
      }
      assert.ok(Date.now()<deadline,'actual configured jobs process must deliver original event');
      await new Promise<void>((resolve)=>setImmediate(resolve));
    }
    const exact = await dreach('GET', `/v1/signing/external-evidence?id=${String(id)}`);
    assert.deepEqual(exact['items'], actual, 'the immutable private citation reads back exactly');
    // Keep the real signature but alter its actual body; this must not append a new fact.
    const altered = frozen.body.replace(frozen.event.signedDocumentSha256, '33'.repeat(32));
    const signature = (await import('node:crypto')).sign(null,
      completionFrame(frozen.event, frozen.body, now, now + 300_000_000n), key.privateKey).toString('base64url');
    const bad = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-DripSign-Issued-At-Micros': now.toString(), 'X-DripSign-Expires-At-Micros': (now + 300_000_000n).toString(),
      'X-DripSign-Signature': signature }, body: altered, redirect: 'error' });
    assert.equal(bad.status, 404); await bad.body?.cancel();
    assert.deepEqual((await dreach('GET', `/v1/signing/external-evidence?id=${String(id)}`))['items'], actual);
    assert.equal(createHash('sha256').update(frozen.body).digest('hex'),
      createHash('sha256').update((await retainedCompletion(pool, finished.agreementId, finished.roundId)).body).digest('hex'));
  } finally { await pool.end(); }
});
