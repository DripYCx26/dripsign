// Email codes. Every request inserts a challenge and answers alike; only a challenge marked `known`
// (a code was mailed) can ever verify. Codes are stored as HMACs under the auth secret.
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { loadConfig } from "../config.ts";
import type { Db } from "../db.ts";
import { DomainError } from "../errors.ts";
import { enqueue } from "../jobs/outbox.ts";
import { AUTH_LIMITS, exhausted, hit } from "./rateLimit.ts";
import type { IssuedChallenge } from "./sessions.ts";
import { hasStanding } from "./standing.ts";

export const CHALLENGE_TTL_MS = 10 * 60_000;
export const MAX_CODE_ATTEMPTS = 5;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/** 32 random bytes, base64url: session and challenge bearer tokens. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only token hashes are stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isTokenShaped(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export interface ChallengeRequest {
  readonly email: string;
  /** Null when the client address is unknown: per-IP limits then do not apply. */
  readonly ip: string | null;
  /** A step-up challenge refreshes this session instead of creating one. */
  readonly sessionId: string | null;
}

/**
 * Applies the request limits, inserts a challenge and mails the code only when the address has
 * standing and its per-email budgets allow. Over a per-email budget the answer is unchanged.
 */
export async function requestChallenge(
  db: Db,
  request: ChallengeRequest,
): Promise<IssuedChallenge> {
  if (request.ip !== null && !(await hit(db, AUTH_LIMITS.requestsPerIp, request.ip))) {
    throw new DomainError("rate_limited", "Too many code requests. Try again in a few minutes.");
  }
  const withinCount = await hit(db, AUTH_LIMITS.challengesPerEmail, request.email);
  const mayMail =
    withinCount && !(await exhausted(db, AUTH_LIMITS.failuresPerEmail, request.email));
  const known = mayMail && (await hasStanding(db, request.email));
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const challenge = await insertChallenge(db, { ...request, code, known });
  if (known) {
    await enqueue(db, {
      tenantId: null,
      agreementId: null,
      dedupeKey: `otp:${challenge.id}`,
      payload: {
        kind: "email",
        to: request.email,
        template: request.sessionId === null ? "otp_code" : "step_up",
        params: { code },
      },
    });
  }
  return { challengeToken: challenge.challengeToken, expiresAt: challenge.expiresAt };
}

/** The insert alone; the development sign-in calls it with a fixed code and mails nothing. */
export async function insertChallenge(
  db: Db,
  input: ChallengeRequest & { readonly code: string; readonly known: boolean },
): Promise<IssuedChallenge & { readonly id: string }> {
  const id = randomUUID();
  const challengeToken = newToken();
  const inserted = await db.query<{ expires_at: Date }>(
    `INSERT INTO dripsign.otp_challenge
       (id, email, token_hash, code_hash, known, session_id, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + $8::float8 * interval '1 millisecond')
     RETURNING expires_at`,
    [
      id,
      input.email,
      hashToken(challengeToken),
      codeHash(id, input.code),
      input.known,
      input.sessionId,
      input.ip,
      CHALLENGE_TTL_MS,
    ],
  );
  const expiresAt = inserted.rows[0]?.expires_at;
  if (expiresAt === undefined) throw new Error("Challenge insert returned no row");
  return { id, challengeToken, expiresAt: expiresAt.toISOString() };
}

export interface CodeAttempt {
  readonly challengeToken: string;
  readonly code: string;
  readonly ip: string | null;
  /** The session a step-up challenge must be bound to; null for a sign-in challenge. */
  readonly sessionId: string | null;
}

export interface ConsumedChallenge {
  readonly email: string;
}

/**
 * Null for any refusal (unknown, expired, consumed, locked, mis-bound, over budget or wrong code);
 * the caller commits so attempts and failures persist, then answers with one message.
 */
export async function consumeChallenge(
  db: Db,
  attempt: CodeAttempt,
): Promise<ConsumedChallenge | null> {
  if (attempt.ip !== null && !(await hit(db, AUTH_LIMITS.verifiesPerIp, attempt.ip))) {
    throw new DomainError("rate_limited", "Too many attempts. Try again in a few minutes.");
  }
  if (!isTokenShaped(attempt.challengeToken)) return null;
  const found = await db.query<{ id: string; email: string; code_hash: string; known: boolean }>(
    `SELECT id, email, code_hash, known FROM dripsign.otp_challenge
     WHERE token_hash = $1 AND session_id IS NOT DISTINCT FROM $2
       AND consumed_at IS NULL AND expires_at > now() AND attempts < $3
     FOR UPDATE`,
    [hashToken(attempt.challengeToken), attempt.sessionId, MAX_CODE_ATTEMPTS],
  );
  const challenge = found.rows[0];
  if (challenge === undefined) return null;
  if (await exhausted(db, AUTH_LIMITS.failuresPerEmail, challenge.email)) return null;
  await db.query("UPDATE dripsign.otp_challenge SET attempts = attempts + 1 WHERE id = $1", [
    challenge.id,
  ]);
  if (!challenge.known || !codeMatches(challenge.id, attempt.code, challenge.code_hash)) {
    await hit(db, AUTH_LIMITS.failuresPerEmail, challenge.email);
    return null;
  }
  await db.query("UPDATE dripsign.otp_challenge SET consumed_at = now() WHERE id = $1", [
    challenge.id,
  ]);
  return { email: challenge.email };
}

function codeHash(challengeId: string, code: string): string {
  return createHmac("sha256", loadConfig().authSecret)
    .update(`${challengeId}:${code}`)
    .digest("hex");
}

function codeMatches(challengeId: string, code: string, stored: string): boolean {
  const supplied = Buffer.from(codeHash(challengeId, code), "hex");
  return timingSafeEqual(supplied, Buffer.from(stored, "hex"));
}
