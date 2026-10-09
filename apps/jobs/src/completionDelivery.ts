import { createHash, createPrivateKey, sign, type KeyObject } from 'node:crypto';
import type { FrozenExecutedEvidence } from '@dripsign/db';
import { canonicalExecutedEvidence } from '@dripsign/db';

export const COMPLETION_PATH = '/v1/webhooks/dripsign';
/** Private process key; it cannot be obtained from the database or a caller's event. */
export interface CompletionKey { readonly keyId: string; readonly keyVersion: number; readonly privateKey: KeyObject }
/** Parses bounded configured Ed25519 seeds; retired keys exist only for explicitly retained outbox pins. */
export function completionKeys(encoded: string): readonly CompletionKey[] {
  if (Buffer.byteLength(encoded) > 4096) throw new Error('Invalid completion signing configuration');
  const values: unknown = JSON.parse(encoded);
  if (!Array.isArray(values) || values.length < 1 || values.length > 8) throw new Error('Invalid completion signing configuration');
  const seen = new Set<string>();
  return values.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid completion signing configuration');
    const object = value as Record<string, unknown>;
    const names = Object.keys(object).sort().join(',');
    if (names !== 'keyId,keyVersion,seed' || typeof object['keyId'] !== 'string' || !/^[!-~]{1,100}$/.test(object['keyId'])
      || typeof object['keyVersion'] !== 'number' || !Number.isInteger(object['keyVersion'])
      || object['keyVersion'] < 1 || object['keyVersion'] > 4_294_967_295
      || typeof object['seed'] !== 'string' || !/^[a-f0-9]{64}$/.test(object['seed'])) {
      throw new Error('Invalid completion signing configuration');
    }
    const identity = `${object['keyId']}:${object['keyVersion']}`;
    if (seen.has(identity)) throw new Error('Invalid completion signing configuration');
    seen.add(identity);
    const seed = Buffer.from(object['seed'], 'hex');
    try { return { keyId: object['keyId'], keyVersion: object['keyVersion'],
      privateKey: createPrivateKey({ format: 'der', type: 'pkcs8', key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'), seed]) }) }; }
    finally { seed.fill(0); }
  });
}
/** The exact frame shared with Rust; no JSON canonicalization occurs in signature construction. */
export function completionFrame(event: FrozenExecutedEvidence['event'], body: string,
  issued: bigint, expires: bigint): Buffer {
  const chunks: Buffer[] = [Buffer.from('dreach.dripsign.executed\0', 'ascii')];
  const version = Buffer.alloc(4); version.writeUInt32BE(1); chunks.push(version);
  for (const value of ['POST', COMPLETION_PATH, event.issuer, event.audience, event.keyId]) {
    if (!/^[!-~]{1,100}$/.test(value)) throw new Error('Invalid completion signing frame');
    const bytes = Buffer.from(value, 'ascii'); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
    chunks.push(length, bytes);
  }
  const keyVersion = Buffer.alloc(4); keyVersion.writeUInt32BE(event.keyVersion); chunks.push(keyVersion);
  const time = Buffer.alloc(16); time.writeBigInt64BE(issued); time.writeBigInt64BE(expires, 8); chunks.push(time);
  chunks.push(createHash('sha256').update(body).digest()); return Buffer.concat(chunks);
}
export type CompletionDelivery = { readonly status: 'delivered'; readonly receipt: string } | { readonly status: 'retry' | 'failed' };
/** Signs actual frozen archival facts with the original key and fresh per-attempt header times. */
export async function deliverCompletion(url: URL, keys: readonly CompletionKey[], frozen: FrozenExecutedEvidence,
  nowMicros: bigint, issuer: string, transport: typeof fetch = fetch): Promise<CompletionDelivery> {
  if (url.protocol !== 'https:' || url.pathname !== COMPLETION_PATH || url.search || url.hash || url.username || url.password) {
    throw new Error('Invalid completion destination');
  }
  if (url.origin!==frozen.event.audience || frozen.event.issuer!==issuer) return {status:'failed'};
  const key = keys.find((item) => item.keyId === frozen.event.keyId && item.keyVersion === frozen.event.keyVersion);
  if (!key) return { status: 'failed' };
  if (canonicalExecutedEvidence(frozen.event) !== frozen.body || Buffer.byteLength(frozen.body) > 1_048_576
    || !Number.isInteger(frozen.freshnessSeconds) || frozen.freshnessSeconds < 1 || frozen.freshnessSeconds > 300
    || BigInt(frozen.event.completedAtMicros) > nowMicros) return { status: 'failed' };
  const expires = nowMicros + BigInt(frozen.freshnessSeconds) * 1_000_000n;
  const signature = sign(null, completionFrame(frozen.event, frozen.body, nowMicros, expires), key.privateKey).toString('base64url');
  try {
    const response = await transport(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-DripSign-Issued-At-Micros': nowMicros.toString(), 'X-DripSign-Expires-At-Micros': expires.toString(),
      'X-DripSign-Signature': signature }, body: frozen.body, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status === 408 || response.status === 429 || response.status >= 500 ? 'retry' : 'failed' };
    }
    const reader=response.body?.getReader(); if (!reader) return {status:'retry'};
    const chunks:Uint8Array[]=[];let length=0;
    try {for (;;) {const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;
      if(length>1024)return {status:'retry'};chunks.push(chunk.value);}}
    finally {await reader.cancel();reader.releaseLock();}
    const answer:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!answer||typeof answer!=='object'||Array.isArray(answer))return {status:'retry'};
    const fields=answer as Record<string,unknown>;
    if(Object.keys(fields).sort().join(',')!=='bodySha256,eventId,evidenceId,recordedAtMicros'
      ||fields['eventId']!==frozen.event.eventId
      ||fields['bodySha256']!==createHash('sha256').update(frozen.body).digest('hex')
      ||typeof fields['evidenceId']!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(fields['evidenceId'])
      ||typeof fields['recordedAtMicros']!=='number'||!Number.isSafeInteger(fields['recordedAtMicros'])
      ||fields['recordedAtMicros']<frozen.event.completedAtMicros)return {status:'retry'};
    return {status:'delivered',receipt:`external_evidence:${fields['evidenceId']}`};
  } catch { return {status:'retry'}; }
}
