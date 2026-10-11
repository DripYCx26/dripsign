import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "./config.ts";
import { DomainError } from "./errors.ts";

/** What store functions take: a pool, or the client of an open transaction. */
export type Db = Pick<pg.ClientBase, "query">;

// A path, not `new URL(..., import.meta.url)`, which Next's bundler rewrites into an asset URL.
const SCHEMA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../schema/schema.sql");
const SCHEMA_LOCK = "dripsign.schema";
const WRITE_SETTINGS =
  "SET LOCAL statement_timeout = '10s'; SET LOCAL lock_timeout = '5s'; " +
  "SET LOCAL idle_in_transaction_session_timeout = '30s'";
const READ_SETTINGS =
  "SET LOCAL statement_timeout = '10s'; SET LOCAL idle_in_transaction_session_timeout = '30s'";

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (pool) return pool;
  pool = new pg.Pool({
    connectionString: loadConfig().databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  // An idle client losing its connection must not crash the process; the pool replaces it.
  pool.on("error", (error) => {
    console.error("dripsign: idle database client error", error.message);
  });
  return pool;
}

export async function closePool(): Promise<void> {
  const current = pool;
  pool = undefined;
  await current?.end();
}

/**
 * READ COMMITTED write transaction. Agreement lock order: receipt, agreement, grant, job rows.
 * Roster changes: tenant roster advisory lock before staff rows or tenant foreign-key locks.
 */
export function tx<T>(fn: (db: Db) => Promise<T>, target: pg.Pool = getPool()): Promise<T> {
  return inTransaction(target, "BEGIN ISOLATION LEVEL READ COMMITTED", WRITE_SETTINGS, fn);
}

/** Consistent snapshot without row locks. */
export function readTx<T>(fn: (db: Db) => Promise<T>, target: pg.Pool = getPool()): Promise<T> {
  return inTransaction(
    target,
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    READ_SETTINGS,
    fn,
  );
}

export function pgErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

export function pgConstraint(error: unknown): string | undefined {
  if (error instanceof Error && "constraint" in error && typeof error.constraint === "string") {
    return error.constraint;
  }
  return undefined;
}

async function inTransaction<T>(
  target: pg.Pool,
  begin: string,
  settings: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const client = await target.connect();
  let broken = false;
  try {
    await client.query(begin);
    await client.query(settings);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      broken = true;
    }
    throw mapDatabaseError(error);
  } finally {
    client.release(broken);
  }
}

function mapDatabaseError(error: unknown): unknown {
  const code = pgErrorCode(error);
  if (code === "55P03" || code === "57014") {
    return new DomainError("unavailable", "The service is busy. Try again.", { cause: error });
  }
  if (code === "40001" || code === "40P01") {
    return new DomainError("conflict", "This agreement changed. Reload to see the latest.", {
      cause: error,
    });
  }
  return error;
}

export interface SchemaFile {
  readonly sql: string;
  readonly sha256: string;
}

export async function readSchemaFile(): Promise<SchemaFile> {
  const bytes = await readFile(SCHEMA_PATH);
  return {
    sql: bytes.toString("utf8"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export type SchemaState = "absent" | "current" | "stale";

export async function schemaState(target: Db = getPool()): Promise<SchemaState> {
  const { sha256 } = await readSchemaFile();
  const present = await target.query<{ schema: boolean; state: boolean }>(
    "SELECT to_regnamespace('dripsign') IS NOT NULL AS schema, " +
      "to_regclass('dripsign.schema_state') IS NOT NULL AS state",
  );
  const row = present.rows[0];
  if (!row?.schema) return "absent";
  if (!row.state) return "stale";
  const applied = await target.query<{ sha256: string }>(
    "SELECT sha256 FROM dripsign.schema_state",
  );
  return applied.rows[0]?.sha256 === sha256 ? "current" : "stale";
}

export async function schemaMatches(target: Db = getPool()): Promise<boolean> {
  return (await schemaState(target)) === "current";
}

/** Applies schema.sql to a database without the dripsign schema and records its hash. */
export async function applySchema(target: pg.Pool = getPool()): Promise<string> {
  const { sql, sha256 } = await readSchemaFile();
  await withSchemaLock(target, async (client) => {
    await client.query(sql);
    await client.query("INSERT INTO dripsign.schema_state (sha256) VALUES ($1)", [sha256]);
  });
  return sha256;
}

/** Development and tests only: the caller checks the environment. */
export async function resetSchema(target: pg.Pool = getPool()): Promise<string> {
  const { sql, sha256 } = await readSchemaFile();
  await withSchemaLock(target, async (client) => {
    await client.query("DROP SCHEMA IF EXISTS dripsign CASCADE");
    await client.query(sql);
    await client.query("INSERT INTO dripsign.schema_state (sha256) VALUES ($1)", [sha256]);
  });
  return sha256;
}

// Schema DDL runs without the request timeouts and under one advisory lock so web, worker and
// CLI starting together cannot interleave.
async function withSchemaLock(
  target: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const client = await target.connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [SCHEMA_LOCK]);
    await fn(client);
    await client.query("COMMIT");
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}
