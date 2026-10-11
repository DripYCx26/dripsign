// Host bridge entry (Dreach DRE-201): the host's server signs a short-lived Ed25519 assertion that
// its page posts here; a verified, unreplayed assertion for a live staff member opens an embedded
// staff session. Token format: dreach crates/dr-authority/src/signin/bridge.rs.
import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { issueSession } from "../auth/sessions.ts";
import type { IssuedSession } from "../auth/sessions.ts";
import { liveStaffSql } from "../auth/standing.ts";
import { loadConfig } from "../config.ts";
import type { HostConfig } from "../config.ts";
import { tx } from "../db.ts";
import { DomainError } from "../errors.ts";
import { emailSchema, uuidSchema } from "../schema.ts";

const TOKEN_TYPE = "dripsign-staff+jwt";
const MAX_ASSERTION_CHARS = 2_048;
const MAX_LIFETIME_SECONDS = 60;
/** How far the host's clock may run ahead of ours when stamping `iat`. */
const CLOCK_SKEW_SECONDS = 30;
const SEGMENT = /^[A-Za-z0-9_-]+$/u;

const headerSchema = z.strictObject({
  alg: z.literal("EdDSA"),
  kid: z.string(),
  typ: z.literal(TOKEN_TYPE),
});

const claimsSchema = z.strictObject({
  iss: z.string(),
  aud: z.string(),
  sub: uuidSchema,
  firm: uuidSchema,
  email: emailSchema,
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().regex(/^[A-Za-z0-9_-]{16,200}$/u),
});

export type BridgeClaims = z.infer<typeof claimsSchema>;

/**
 * Pure: the claims of a well-formed, correctly signed, unexpired assertion addressed to us by the
 * configured issuer, else null. Replay is checked by `acceptBridgeAssertion`.
 */
export function verifyBridgeToken(
  token: string,
  entry: HostConfig["entry"],
  nowSeconds: number,
): BridgeClaims | null {
  const parts = compactParts(token);
  if (parts === null) return null;
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = headerSchema.safeParse(decodeJson(encodedHeader));
  const key = header.success ? entry.keys.find((item) => item.kid === header.data.kid) : undefined;
  const signature = Buffer.from(encodedSignature, "base64url");
  if (
    key === undefined ||
    signature.length !== 64 ||
    signature.toString("base64url") !== encodedSignature
  ) {
    return null;
  }
  const signed = Buffer.from(`${encodedHeader}.${encodedClaims}`, "ascii");
  if (!verify(null, signed, ed25519PublicKey(key.publicKey), signature)) return null;
  const claims = claimsSchema.safeParse(decodeJson(encodedClaims));
  if (!claims.success || !timely(claims.data, nowSeconds)) return null;
  const { iss, aud } = claims.data;
  return iss === entry.issuer && aud === entry.audience ? claims.data : null;
}

/**
 * The bridge entry: the form field `assertion`, posted from the host's page (`origin`). Every
 * refusal answers alike; the nonce is spent even when the email is not live staff.
 */
export async function acceptBridgeAssertion(
  form: FormData,
  origin: string | null,
): Promise<IssuedSession> {
  const host = loadConfig().host;
  if (host === null || origin !== new URL(host.origin).origin) throw refused();
  const assertion = form.get("assertion");
  if (typeof assertion !== "string") throw refused();
  const claims = verifyBridgeToken(assertion, host.entry, Math.floor(Date.now() / 1_000));
  const tenant = host.tenants.find((item) => item.firm === claims?.firm);
  if (claims === null || tenant === undefined) throw refused();
  const issued = await tx(async (db) => {
    const nonce = await db.query(
      `INSERT INTO dripsign.bridge_nonce (jti, expires_at) VALUES ($1, to_timestamp($2))
       ON CONFLICT (jti) DO NOTHING`,
      [claims.jti, claims.exp],
    );
    if (nonce.rowCount !== 1) return null;
    const staff = await db.query(`${liveStaffSql("$1")} AND st.tenant_id = $2`, [
      claims.email,
      tenant.tenantId,
    ]);
    if (staff.rowCount !== 1) return null;
    return issueSession(db, { email: claims.email, embed: true, staffTenantId: tenant.tenantId });
  });
  if (issued === null) throw refused();
  return issued;
}

function compactParts(token: string): readonly [string, string, string] | null {
  if (token.length > MAX_ASSERTION_CHARS) return null;
  const [header, claims, signature, ...rest] = token.split(".");
  if (header === undefined || claims === undefined || signature === undefined) return null;
  const parts = [header, claims, signature] as const;
  return rest.length === 0 && parts.every((part) => SEGMENT.test(part)) ? parts : null;
}

function timely(claims: BridgeClaims, nowSeconds: number): boolean {
  return (
    claims.exp > claims.iat &&
    claims.exp - claims.iat <= MAX_LIFETIME_SECONDS &&
    claims.iat <= nowSeconds + CLOCK_SKEW_SECONDS &&
    nowSeconds < claims.exp
  );
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** The configured key is the raw 32-byte public key, base64url: exactly a JWK `x`. */
function ed25519PublicKey(x: string): ReturnType<typeof createPublicKey> {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
}

function refused(): DomainError {
  return new DomainError("not_found", "This sign-in link isn’t valid. Open it again.");
}
