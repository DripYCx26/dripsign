import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { transaction } from './connection.ts';

// Run with the migration identity; the runtime identity never owns the schema.
export async function migrate(pool: Pool, useOwnerRole = false): Promise<void> {
  const directory = new URL('../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => /^\d{8}T\d{4}_.+\.sql$/.test(file)).sort();
  await transaction(pool, async (client) => {
    if(useOwnerRole)await client.query('SET LOCAL ROLE dripsign_owner');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dripsign:migrations',0))");
    await client.query('CREATE SCHEMA IF NOT EXISTS dripsign');
    await client.query('CREATE TABLE IF NOT EXISTS dripsign.schema_migration (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const file of files) {
      const sql = await readFile(new URL(file, directory), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const prior = await client.query<{ sha256: string }>('SELECT sha256 FROM dripsign.schema_migration WHERE name=$1', [file]);
      if (prior.rows[0]) {
        if (prior.rows[0].sha256 !== hash) throw new Error('An applied migration has changed');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO dripsign.schema_migration(name,sha256) VALUES($1,$2)', [file, hash]);
    }
  });
}
