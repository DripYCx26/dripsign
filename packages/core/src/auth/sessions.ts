// Sessions are a verified email. Staff and recipient standing are re-read from live rows on every
// call; nothing about roles is stored on the session.
import { loadConfig } from "../config.ts";
import { getPool, tx } from "../db.ts";
import type { Db } from "../db.ts";
import { DomainError, notFound } from "../errors.ts";
import { emailSchema, uuidSchema } from "../schema.ts";
import type { RecipientActor, SessionView, StaffActor, StaffRole } from "../types.ts";
import {
  consumeChallenge,
  hashToken,
  insertChallenge,
  isTokenShaped,
  newToken,
  requestChallenge,
} from "./otp.ts";
import { hasStanding, liveStaffSql, recipientGrantSql } from "./standing.ts";

export { CHALLENGE_TTL_MS } from "./otp.ts";
export const SESSION_TTL_MS = 12 * 60 * 60_000;
/** Host bridge sessions are staff-only and shorter. */
export const EMBED_SESSION_TTL_MS = 8 * 60 * 60_000;
/** Signing needs an email verification at most this old. */
export const SIGNING_VERIFICATION_MAX_AGE_MS = 30 * 60_000;

/** The development sign-in's fixed code; config refuses DRIPSIGN_DEV_LOGIN outside loopback dev. */
const DEV_CODE = "000000";

/** A verified email. Roles are never stored here; they are resolved per request. */
export interface Session {
  readonly id: string;
  readonly email: string;
  readonly verifiedAt: string;
  readonly expiresAt: string;
  readonly staffTenantId: string | null;
  readonly embed: boolean;
}

export interface ResolvedSession {
  readonly session: Session;
  readonly view: SessionView;
}

export interface IssuedChallenge {
  readonly challengeToken: string;
  readonly expiresAt: string;
}

export interface IssuedSession {
  readonly sessionToken: string;
  readonly expiresAt: string;
}

/**
 * Always inserts a challenge and answers the same way; mails a code only to live staff or live
 * recipients. With `stepUpSessionToken` the challenge is bound to that session (re-verify).
 */
export async function requestCode(
  email: string,
  ip: string | null,
  stepUpSessionToken?: string,
): Promise<IssuedChallenge> {
  const address = parseEmail(email);
  return tx(async (db) => {
    let sessionId: string | null = null;
    if (stepUpSessionToken !== undefined) {
      const session = await liveSessionByToken(db, stepUpSessionToken);
      if (session?.email !== address) throw sessionEnded();
      sessionId = session.id;
    }
    return requestChallenge(db, { email: address, ip, sessionId });
  });
}

/**
 * Consumes a code. A step-up challenge refreshes `verified_at` on the bound session, which must be
 * `stepUpSessionToken`, and returns that same token; otherwise a new session is issued.
 */
export async function verifyCode(
  challengeToken: string,
  code: string,
  ip: string | null,
  stepUpSessionToken?: string,
): Promise<IssuedSession> {
  const issued = await tx(async (db) => {
    if (stepUpSessionToken === undefined) {
      const consumed = await consumeChallenge(db, { challengeToken, code, ip, sessionId: null });
      return consumed === null ? null : issueSession(db, { email: consumed.email, embed: false });
    }
    const session = await liveSessionByToken(db, stepUpSessionToken);
    if (session === null) throw sessionEnded();
    const consumed = await consumeChallenge(db, {
      challengeToken,
      code,
      ip,
      sessionId: session.id,
    });
    return consumed === null ? null : refreshVerification(db, session.id, stepUpSessionToken);
  });
  if (issued === null) throw wrongCode();
  return issued;
}

/** Null when the token is unknown, expired or revoked. */
export async function readSession(sessionToken: string): Promise<ResolvedSession | null> {
  if (!isTokenShaped(sessionToken)) return null;
  const row = await loadSession(getPool(), "token_hash", hashToken(sessionToken));
  return row === null ? null : resolved(row);
}

/** Live staff row for the selected tenant (auto-selected when exactly one), else not_found. */
export async function resolveStaff(session: Session): Promise<StaffActor> {
  const row = await loadSession(getPool(), "id", session.id);
  if (row === null) throw staffNotFound();
  const tenantId = selectedTenant(row);
  const tenant = row.staff_tenants.find((candidate) => candidate.id === tenantId);
  if (tenant === undefined) throw staffNotFound();
  return {
    capacity: "staff",
    tenantId: tenant.id,
    email: row.email,
    sessionId: row.id,
    verifiedAt: row.verified_at.toISOString(),
    role: tenant.role,
  };
}

/** Live recipient row for this agreement and email on a published agreement, else not_found. */
export async function resolveRecipient(
  session: Session,
  agreementId: string,
): Promise<RecipientActor> {
  if (!uuidSchema.safeParse(agreementId).success) throw notFound();
  const found = await getPool().query<{ id: string; email: string; verified_at: Date }>(
    `SELECT s.id, s.email, s.verified_at FROM dripsign.auth_session s
     WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND NOT s.embed
       AND EXISTS (${recipientGrantSql("s.email")} AND r.agreement_id = $2)`,
    [session.id, agreementId],
  );
  const row = found.rows[0];
  if (row === undefined) throw notFound();
  return {
    capacity: "recipient",
    email: row.email,
    sessionId: row.id,
    verifiedAt: row.verified_at.toISOString(),
  };
}

/** A bridge session stays on its host tenant. */
export async function selectTenant(session: Session, tenantId: string): Promise<void> {
  if (!uuidSchema.safeParse(tenantId).success) throw staffNotFound();
  const updated = await getPool().query(
    `UPDATE dripsign.auth_session s SET staff_tenant_id = $2
     WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
       AND (NOT s.embed OR s.staff_tenant_id = $2)
       AND EXISTS (${liveStaffSql("s.email")} AND st.tenant_id = $2)`,
    [session.id, tenantId],
  );
  if (updated.rowCount !== 1) throw staffNotFound();
}

export async function signOut(sessionToken: string): Promise<void> {
  if (!isTokenShaped(sessionToken)) return;
  await getPool().query(
    "UPDATE dripsign.auth_session SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [hashToken(sessionToken)],
  );
}

/** Runs the real issue and consume with a fixed code; refused unless config.devLogin. */
export async function devSignIn(email: string): Promise<IssuedSession> {
  if (!loadConfig().devLogin) throw notFound();
  const address = parseEmail(email);
  const issued = await tx(async (db) => {
    const request = { email: address, ip: null, sessionId: null };
    const known = await hasStanding(db, address);
    const challenge = await insertChallenge(db, { ...request, code: DEV_CODE, known });
    const attempt = { ...request, challengeToken: challenge.challengeToken, code: DEV_CODE };
    const consumed = await consumeChallenge(db, attempt);
    return consumed === null ? null : issueSession(db, { email: consumed.email, embed: false });
  });
  if (issued === null) throw wrongCode();
  return issued;
}

export interface NewSession {
  readonly email: string;
  readonly embed: boolean;
  /** Embed sessions name their tenant; otherwise the only live staff tenant is selected. */
  readonly staffTenantId?: string;
}

/** Inserts a session in the caller's transaction; the host bridge shares it. */
export async function issueSession(db: Db, input: NewSession): Promise<IssuedSession> {
  const sessionToken = newToken();
  const ttlMs = input.embed ? EMBED_SESSION_TTL_MS : SESSION_TTL_MS;
  const inserted = await db.query<{ expires_at: Date }>(
    `INSERT INTO dripsign.auth_session
       (id, token_hash, email, staff_tenant_id, embed, verified_at, expires_at)
     VALUES (gen_random_uuid(), $1, $2::text,
       coalesce($3::uuid, (SELECT (array_agg(st.tenant_id))[1] FROM dripsign.staff st
         WHERE st.email = $2::text AND st.revoked_at IS NULL HAVING count(*) = 1)),
       $4, now(), now() + $5::float8 * interval '1 millisecond')
     RETURNING expires_at`,
    [hashToken(sessionToken), input.email, input.staffTenantId ?? null, input.embed, ttlMs],
  );
  const expiresAt = inserted.rows[0]?.expires_at;
  if (expiresAt === undefined) throw new Error("Session insert returned no row");
  return { sessionToken, expiresAt: expiresAt.toISOString() };
}

async function refreshVerification(
  db: Db,
  sessionId: string,
  sessionToken: string,
): Promise<IssuedSession> {
  const updated = await db.query<{ expires_at: Date }>(
    "UPDATE dripsign.auth_session SET verified_at = now() WHERE id = $1 RETURNING expires_at",
    [sessionId],
  );
  const expiresAt = updated.rows[0]?.expires_at;
  if (expiresAt === undefined) throw sessionEnded();
  return { sessionToken, expiresAt: expiresAt.toISOString() };
}

async function liveSessionByToken(
  db: Db,
  token: string,
): Promise<{ id: string; email: string } | null> {
  if (!isTokenShaped(token)) return null;
  const found = await db.query<{ id: string; email: string }>(
    `SELECT id, email FROM dripsign.auth_session
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
     FOR UPDATE`,
    [hashToken(token)],
  );
  return found.rows[0] ?? null;
}

interface StaffTenant {
  readonly id: string;
  readonly name: string;
  readonly role: StaffRole;
}

interface SessionRow {
  readonly id: string;
  readonly email: string;
  readonly verified_at: Date;
  readonly expires_at: Date;
  readonly staff_tenant_id: string | null;
  readonly embed: boolean;
  readonly staff_tenants: readonly StaffTenant[];
  readonly has_recipient_grants: boolean;
}

/** One statement, so the session, its staff tenants and its grants come from one snapshot. */
async function loadSession(
  db: Db,
  by: "token_hash" | "id",
  value: string,
): Promise<SessionRow | null> {
  const found = await db.query<SessionRow>(
    `SELECT s.id, s.email, s.verified_at, s.expires_at, s.staff_tenant_id, s.embed,
       coalesce((
         SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'role', st.role)
           ORDER BY t.name, t.id)
         FROM dripsign.staff st JOIN dripsign.tenant t ON t.id = st.tenant_id
         WHERE st.email = s.email AND st.revoked_at IS NULL
           AND (NOT s.embed OR st.tenant_id = s.staff_tenant_id)
       ), '[]'::jsonb) AS staff_tenants,
       (NOT s.embed AND EXISTS (${recipientGrantSql("s.email")})) AS has_recipient_grants
     FROM dripsign.auth_session s
     WHERE s.${by} = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [value],
  );
  return found.rows[0] ?? null;
}

/** The stored choice while it is still live; otherwise the only live tenant (never for embed). */
function selectedTenant(row: SessionRow): string | null {
  const ids = row.staff_tenants.map((tenant) => tenant.id);
  if (row.staff_tenant_id !== null && ids.includes(row.staff_tenant_id)) return row.staff_tenant_id;
  return !row.embed && ids.length === 1 ? (ids[0] ?? null) : null;
}

function resolved(row: SessionRow): ResolvedSession {
  const verifiedAt = row.verified_at.toISOString();
  const expiresAt = row.expires_at.toISOString();
  return {
    session: {
      id: row.id,
      email: row.email,
      verifiedAt,
      expiresAt,
      staffTenantId: row.staff_tenant_id,
      embed: row.embed,
    },
    view: {
      email: row.email,
      verifiedAt,
      expiresAt,
      staffTenants: row.staff_tenants,
      selectedTenantId: selectedTenant(row),
      hasRecipientGrants: row.has_recipient_grants,
      embed: row.embed,
      devLogin: loadConfig().devLogin,
    },
  };
}

function parseEmail(email: string): string {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) throw new DomainError("invalid", "Enter a valid email address.");
  return parsed.data;
}

function wrongCode(): DomainError {
  return new DomainError("invalid", "That code is wrong or has expired. Request a new code.");
}

function sessionEnded(): DomainError {
  return new DomainError("not_found", "Your session has ended. Sign in again.");
}

function staffNotFound(): DomainError {
  return new DomainError("not_found", "This workspace isn’t available.");
}
