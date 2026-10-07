import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { StaffActor } from '@dripsign/db';
import { getConfiguration } from './config';
import { HttpError } from './http';
import { getStore } from './store';

const assertionSchema = z.strictObject({
  issuer: z.string().min(1).max(100), audience: z.string().min(1).max(100),
  subject: z.string().min(1).max(200), tenantId: z.uuid(),
  resource: z.string().min(1).max(200), operation: z.string().min(1).max(100),
  method: z.enum(['GET', 'POST']), path: z.string().startsWith('/').max(1000),
  bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: z.number().int().positive(), expiresAt: z.number().int().positive(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22,128}$/),
});

/** Verify a request-bound, one-use server assertion, then recheck native staff membership. */
export async function bridgeActor(
  request: Request, bytes: Uint8Array, resource: string, operation: string,
): Promise<StaffActor> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length > 8192) throw new HttpError(401, 'authentication_required');
  const parts = authorization.slice(7).split('.');
  const encoded = parts[0];
  const signature = parts[1];
  if (parts.length !== 2 || !encoded || !signature || !/^[A-Za-z0-9_-]+$/.test(encoded)
    || !/^[A-Za-z0-9_-]{43}$/.test(signature)) throw new HttpError(401, 'authentication_required');
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown; }
  catch { throw new HttpError(401, 'authentication_required'); }
  const result = assertionSchema.safeParse(decoded);
  if (!result.success) throw new HttpError(401, 'authentication_required');
  const claims = result.data;
  const issuer = getConfiguration().bridgeIssuers.find((entry) => entry.issuer === claims.issuer && entry.audience === claims.audience);
  if (!issuer) throw new HttpError(401, 'authentication_required');
  const expected = createHmac('sha256', issuer.secret).update(encoded).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new HttpError(401, 'authentication_required');
  const now = Math.floor(Date.now() / 1000);
  const url = new URL(request.url);
  if (claims.expiresAt <= now || claims.issuedAt > now || claims.expiresAt - claims.issuedAt > 30
    || claims.expiresAt <= claims.issuedAt || claims.resource !== resource || claims.operation !== operation
    || claims.method !== request.method || claims.path !== url.pathname + url.search
    || claims.bodySha256 !== createHash('sha256').update(bytes).digest('hex')) {
    throw new HttpError(401, 'authentication_required');
  }
  const store = getStore();
  const actor: StaffActor = { kind: 'staff', tenantId: claims.tenantId, userId: claims.subject };
  const consumed = await store.consumeBridgeAssertion({ nonce: `${claims.issuer}:${claims.nonce}`, actor,
    agreementId: resource === 'agreements' ? null : resource, operation, method: claims.method, path: claims.path,
    bodyHash: claims.bodySha256, expiresAt: new Date(claims.expiresAt * 1000).toISOString(),
  });
  if (!consumed) throw new HttpError(401, 'authentication_required');
  await store.assertStaff(actor);
  return actor;
}
