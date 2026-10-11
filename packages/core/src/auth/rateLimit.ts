// Fixed-window counters on the rate_limit table. One row per (rule, subject, window).
import type { Db } from "../db.ts";

export interface RateRule {
  readonly name: string;
  readonly max: number;
  readonly windowMs: number;
}

const MINUTE_MS = 60_000;

/** The authentication limits (arch-lock §22). */
export const AUTH_LIMITS = {
  requestsPerIp: { name: "otp_request_ip", max: 10, windowMs: 10 * MINUTE_MS },
  verifiesPerIp: { name: "otp_verify_ip", max: 30, windowMs: 10 * MINUTE_MS },
  challengesPerEmail: { name: "otp_request_email", max: 5, windowMs: 60 * MINUTE_MS },
  failuresPerEmail: { name: "otp_failure_email", max: 15, windowMs: 24 * 60 * MINUTE_MS },
} as const satisfies Record<string, RateRule>;

// The window start is computed in SQL so every process agrees on the database clock.
const WINDOW_START =
  "to_timestamp(floor(extract(epoch FROM now()) * 1000 / $2::numeric) * $2::numeric / 1000)";

/** Counts one hit and answers whether it is still within the rule's limit. */
export async function hit(db: Db, rule: RateRule, subject: string): Promise<boolean> {
  const counted = await db.query<{ hits: number }>(
    `INSERT INTO dripsign.rate_limit (key, window_start, hits)
     VALUES ($1, ${WINDOW_START}, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET hits = dripsign.rate_limit.hits + 1
     RETURNING hits`,
    [keyOf(rule, subject), rule.windowMs],
  );
  return (counted.rows[0]?.hits ?? 1) <= rule.max;
}

/** True once the current window already holds `max` hits; counts nothing. */
export async function exhausted(db: Db, rule: RateRule, subject: string): Promise<boolean> {
  const current = await db.query<{ hits: number }>(
    `SELECT hits FROM dripsign.rate_limit WHERE key = $1 AND window_start = ${WINDOW_START}`,
    [keyOf(rule, subject), rule.windowMs],
  );
  return (current.rows[0]?.hits ?? 0) >= rule.max;
}

function keyOf(rule: RateRule, subject: string): string {
  return `${rule.name}:${subject}`;
}
