// Outbox primitives. Every state change after a claim is fenced by the job's lease token.
import type { Db } from "../db.ts";
import { jobPayloadSchema } from "../schema.ts";
import type { JobKind, JobPayload } from "../schema.ts";

export const OUTBOX_CHANNEL = "dripsign_outbox";

/** Attempts before a job is failed. Archive never fails: a signed agreement must not get stuck. */
export const JOB_MAX_ATTEMPTS: Readonly<Record<JobKind, number | null>> = {
  email: 5,
  pdf_prepare: 2,
  // At most once: a second claim means the first may have spent, so it fails instead.
  ai_suggest: 1,
  archive: null,
  host_event: 20,
};

export interface NewJob {
  readonly tenantId: string | null;
  readonly agreementId: string | null;
  /** Unique across the outbox; include the tenant or resource id. Null means never deduplicated. */
  readonly dedupeKey: string | null;
  readonly payload: JobPayload;
  readonly availableAt?: Date;
}

export interface JobLease {
  readonly id: string;
  readonly leaseToken: string;
}

export interface ClaimedJob<P extends JobPayload = JobPayload> extends JobLease {
  readonly tenantId: string | null;
  readonly agreementId: string | null;
  readonly attempts: number;
  readonly leaseUntil: Date;
  readonly createdAt: Date;
  readonly payload: P;
}

export type JobOf<K extends JobKind> = ClaimedJob<Extract<JobPayload, { kind: K }>>;
export type JobHandler<K extends JobKind> = (job: JobOf<K>, signal: AbortSignal) => Promise<void>;
export type JobHandlers = { readonly [K in JobKind]: JobHandler<K> };

/** Inserts a job in the caller's transaction and wakes workers on commit. Null when deduplicated. */
export async function enqueue(db: Db, job: NewJob): Promise<string | null> {
  const payload = jobPayloadSchema.parse(job.payload);
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO dripsign.outbox (tenant_id, agreement_id, kind, payload, dedupe_key, available_at)
     VALUES ($1, $2, $3, $4, $5, coalesce($6, now()))
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      job.tenantId,
      job.agreementId,
      payload.kind,
      JSON.stringify(payload),
      job.dedupeKey,
      job.availableAt ?? null,
    ],
  );
  const id = inserted.rows[0]?.id ?? null;
  if (id !== null) await db.query("SELECT pg_notify($1, $2)", [OUTBOX_CHANNEL, payload.kind]);
  return id;
}

interface ClaimRow {
  id: string;
  tenant_id: string | null;
  agreement_id: string | null;
  payload: unknown;
  attempts: number;
  lease_token: string;
  lease_until: Date;
  created_at: Date;
}

/**
 * One statement: picks due pending jobs and expired running leases, issues new lease tokens and
 * counts the attempt. Rows whose payload no longer parses are failed and not returned.
 */
export async function claimJobs(
  db: Db,
  options: { readonly limit: number; readonly leaseMs: number },
): Promise<ClaimedJob[]> {
  const claimed = await db.query<ClaimRow>(
    `WITH due AS (
       SELECT id FROM dripsign.outbox
       WHERE status IN ('pending', 'running') AND available_at <= now()
       ORDER BY available_at, id
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE dripsign.outbox o
     SET status = 'running',
         attempts = o.attempts + 1,
         lease_token = gen_random_uuid(),
         lease_until = now() + $2::float8 * interval '1 millisecond',
         available_at = now() + $2::float8 * interval '1 millisecond'
     FROM due
     WHERE o.id = due.id
     RETURNING o.id, o.tenant_id, o.agreement_id, o.payload, o.attempts, o.lease_token,
       o.lease_until, o.created_at`,
    [options.limit, options.leaseMs],
  );
  const jobs: ClaimedJob[] = [];
  for (const row of claimed.rows) {
    const payload = jobPayloadSchema.safeParse(row.payload);
    const lease = { id: row.id, leaseToken: row.lease_token };
    if (!payload.success) {
      await failJob(db, lease, "Stored payload is invalid");
      continue;
    }
    jobs.push({
      ...lease,
      tenantId: row.tenant_id,
      agreementId: row.agreement_id,
      attempts: row.attempts,
      leaseUntil: row.lease_until,
      createdAt: row.created_at,
      payload: payload.data,
    });
  }
  return jobs;
}

/** A reclaimed job past its kind's limit must be failed (with its fail hook), not run. */
export function isExhausted(job: ClaimedJob): boolean {
  const max = JOB_MAX_ATTEMPTS[job.payload.kind];
  return max !== null && job.attempts > max;
}

/**
 * Locks the job row inside a domain transaction that commits the job's effect. Take it after the
 * agreement row. False means another worker holds the job now; the effect must not commit.
 */
export async function lockLease(db: Db, lease: JobLease): Promise<boolean> {
  const locked = await db.query(
    `SELECT 1 FROM dripsign.outbox
     WHERE id = $1 AND lease_token = $2 AND status = 'running'
     FOR UPDATE`,
    [lease.id, lease.leaseToken],
  );
  return locked.rowCount === 1;
}

/** Email params can hold an OTP code, so they are scrubbed once delivered. */
export async function finishJob(db: Db, lease: JobLease): Promise<boolean> {
  const finished = await db.query(
    `UPDATE dripsign.outbox
     SET status = 'done',
         finished_at = now(),
         lease_token = NULL,
         lease_until = NULL,
         last_error = NULL,
         payload = CASE WHEN kind = 'email'
           THEN jsonb_set(payload, '{params}', '{}'::jsonb) ELSE payload END
     WHERE id = $1 AND lease_token = $2 AND status = 'running'`,
    [lease.id, lease.leaseToken],
  );
  return finished.rowCount === 1;
}

export type RetryOutcome = "retrying" | "failed" | "lost";

/**
 * Schedules another attempt with backoff min(10s * 2^(attempts-1), 1h) plus up to 1s jitter, or
 * fails the job once its kind's attempts are spent. `delayMs` overrides the backoff (Retry-After).
 */
export async function retryJob(
  db: Db,
  job: ClaimedJob,
  error: string,
  delayMs?: number,
): Promise<RetryOutcome> {
  const retried = await db.query<{ status: "pending" | "failed" }>(
    `UPDATE dripsign.outbox
     SET status = CASE WHEN attempts >= $3::integer THEN 'failed' ELSE 'pending' END,
         finished_at = CASE WHEN attempts >= $3::integer THEN now() END,
         available_at = now() + coalesce(
           $4::float8 * interval '1 millisecond',
           make_interval(secs => least(10 * power(2, attempts - 1), 3600) + random())
         ),
         lease_token = NULL,
         lease_until = NULL,
         last_error = left($5, 2000)
     WHERE id = $1 AND lease_token = $2 AND status = 'running'
     RETURNING status`,
    [job.id, job.leaseToken, JOB_MAX_ATTEMPTS[job.payload.kind], delayMs ?? null, error],
  );
  const status = retried.rows[0]?.status;
  if (status === undefined) return "lost";
  return status === "failed" ? "failed" : "retrying";
}

export async function failJob(db: Db, lease: JobLease, error: string): Promise<boolean> {
  const failed = await db.query(
    `UPDATE dripsign.outbox
     SET status = 'failed',
         finished_at = now(),
         lease_token = NULL,
         lease_until = NULL,
         last_error = left($3, 2000)
     WHERE id = $1 AND lease_token = $2 AND status = 'running'`,
    [lease.id, lease.leaseToken, error],
  );
  return failed.rowCount === 1;
}
