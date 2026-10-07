import pg from 'pg';
import type { Pool, PoolClient } from 'pg';

export function createPool(databaseUrl: string): Pool {
  if (!databaseUrl) throw new Error('Database configuration is required');
  return new pg.Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000, statement_timeout: 10_000 });
}
export async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    try { await client.query('ROLLBACK'); }
    catch (rollbackError: unknown) { client.release(true); released = true; throw new AggregateError([error, rollbackError], 'Transaction rollback failed'); }
    throw error;
  } finally {
    if (!released) client.release();
  }
}
