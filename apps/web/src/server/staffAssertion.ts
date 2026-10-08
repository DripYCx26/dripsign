import { createHash, createPublicKey, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { z } from 'zod';

/** The longest validity a host may give an assertion; the host chooses less. */
export const MAX_LIFETIME_SECONDS = 120;
// ASSUMPTION: host and DripSign clocks agree within five seconds (both run NTP-synchronized).
const CLOCK_SKEW_SECONDS = 5;
const TOKEN_TYPE = 'dripsign-staff+jwt';

/** One trusted host public key, named by the first 16 hex digits of its SHA-256. */
export interface HostKey { readonly id: string; readonly key: KeyObject }

/** What DripSign trusts: the host's exact origin as issuer, its own origin as audience, the keys. */
export interface BridgeTrust { readonly hostOrigin: string; readonly audience: string; readonly keys: readonly HostKey[] }

/** The claims a valid assertion establishes; DripSign still checks its own staff membership. */
export interface StaffAssertion {
  readonly subject: string; readonly tenantId: string; readonly email: string;
  readonly nonce: string; readonly expiresAt: number;
}

const headerSchema = z.strictObject({ alg: z.literal('EdDSA'), kid: z.string().regex(/^[a-f0-9]{16}$/), typ: z.literal(TOKEN_TYPE) });
const claimsSchema = z.strictObject({
  iss: z.string().max(200), aud: z.string().max(200), sub: z.uuid(), firm: z.uuid(),
  email: z.email().max(254), iat: z.number().int().positive(), exp: z.number().int().positive(),
  jti: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
});

/** Parse one 64-hex Ed25519 public key; its id is derived, so a new key is a new id. */
export function hostKey(hex: string): HostKey {
  if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error('A bridge public key must be 64 lowercase hex digits');
  const raw = Buffer.from(hex, 'hex');
  return {
    id: createHash('sha256').update(raw).digest('hex').slice(0, 16),
    key: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' }),
  };
}

function decode(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
}

/**
 * Verify a host's signed staff assertion at `now` (Unix seconds). Every failure is the same
 * `null`, so a caller cannot tell a forged token from an expired one. The nonce is not consumed
 * here; the store records it once in the same transaction that opens the session.
 */
export function verifyStaffAssertion(token: string, trust: BridgeTrust, now: number): StaffAssertion | null {
  if (token.length > 2048) return null;
  const parts = token.split('.');
  const [header, body, signature] = parts;
  if (parts.length !== 3 || !header || !body || !signature
    || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  let parsedHeader: z.infer<typeof headerSchema>;
  let claims: z.infer<typeof claimsSchema>;
  try {
    parsedHeader = headerSchema.parse(decode(header));
    claims = claimsSchema.parse(decode(body));
  } catch { return null; }
  const trusted = trust.keys.find((entry) => entry.id === parsedHeader.kid);
  const bytes = Buffer.from(signature, 'base64url');
  if (!trusted || bytes.length !== 64
    || !verify(null, Buffer.from(`${header}.${body}`, 'ascii'), trusted.key, bytes)) return null;
  if (claims.iss !== trust.hostOrigin || claims.aud !== trust.audience
    || claims.iat > now + CLOCK_SKEW_SECONDS || claims.exp <= now
    || claims.exp <= claims.iat || claims.exp - claims.iat > MAX_LIFETIME_SECONDS) return null;
  return { subject: claims.sub, tenantId: claims.firm, email: claims.email, nonce: claims.jti, expiresAt: claims.exp };
}
