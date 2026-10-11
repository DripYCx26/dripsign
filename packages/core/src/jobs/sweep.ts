import { getPool } from "../db.ts";
import { enqueue } from "./outbox.ts";

const RETENTION_BATCH_SIZE = 1000;
const RETENTION = [
  ["otp_challenge", "created_at < now() - interval '1 day'"],
  ["auth_session", "expires_at < now() - interval '30 days'"],
  ["rate_limit", "window_start < now() - interval '1 day'"],
  ["bridge_nonce", "expires_at < now()"],
  [
    "outbox",
    "(status = 'done' AND finished_at < now() - interval '30 days') OR (status = 'failed' AND finished_at < now() - interval '90 days')",
  ],
  ["command_receipt", "created_at < now() - interval '30 days'"],
  [
    "ai_suggestion",
    "status <> 'queued' AND coalesce(applied_at, finished_at) < now() - interval '90 days'",
  ],
] as const;

export async function sweepRetention(): Promise<void> {
  const client = await getPool().connect();
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('dripsign.retention')) AS locked",
    );
    locked = result.rows[0]?.locked === true;
    if (!locked) return;
    // One bounded batch and transaction per table per sweep, so a backlog cannot monopolize locks.
    for (const [table, predicate] of RETENTION) {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query(
        `DELETE FROM dripsign.${table} WHERE ctid IN (
           SELECT ctid FROM dripsign.${table} WHERE ${predicate}
           LIMIT $1 FOR UPDATE SKIP LOCKED
         )`,
        [RETENTION_BATCH_SIZE],
      );
      await client.query("COMMIT");
    }
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('dripsign.retention'))");
    } finally {
      client.release();
    }
  }
}

export async function rescueArchives(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext('dripsign.archive-rescue')) AS locked",
    );
    if (!locked.rows[0]?.locked) {
      await client.query("COMMIT");
      return;
    }
    const rounds = await client.query<{ tenant_id: string; agreement_id: string; id: string }>(
      `SELECT r.tenant_id, r.agreement_id, r.id FROM dripsign.signing_round r
       WHERE r.status = 'finalizing' AND NOT EXISTS (
         SELECT 1 FROM dripsign.outbox o WHERE o.tenant_id = r.tenant_id
         AND o.kind = 'archive' AND o.payload->>'roundId' = r.id::text AND o.status IN ('pending', 'running'))
       ORDER BY r.finalizing_at LIMIT 100`,
    );
    for (const round of rounds.rows)
      await enqueue(client, {
        tenantId: round.tenant_id,
        agreementId: round.agreement_id,
        dedupeKey: null,
        payload: { kind: "archive", roundId: round.id },
      });
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function startSweep(): { stop(): void } {
  let retaining = false;
  let rescuing = false;
  const log = (): void => {
    console.error("dripsign: sweep unavailable");
  };
  const retention = (): void => {
    if (retaining) return;
    retaining = true;
    void sweepRetention()
      .catch(log)
      .finally(() => {
        retaining = false;
      });
  };
  const rescue = (): void => {
    if (rescuing) return;
    rescuing = true;
    void rescueArchives()
      .catch(log)
      .finally(() => {
        rescuing = false;
      });
  };
  const retentionTimer = setInterval(retention, 10 * 60_000);
  const rescueTimer = setInterval(rescue, 60_000);
  retention();
  rescue();
  return {
    stop: () => {
      clearInterval(retentionTimer);
      clearInterval(rescueTimer);
    },
  };
}
