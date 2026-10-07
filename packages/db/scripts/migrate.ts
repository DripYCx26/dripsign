import { createPool } from '../src/connection.ts';
import { migrate } from '../src/migrations.ts';
const databaseUrl=process.env['DRIPSIGN_MIGRATION_DATABASE_URL'];
if(!databaseUrl)throw new Error('DRIPSIGN_MIGRATION_DATABASE_URL is required');
const pool=createPool(databaseUrl);
try {
  await migrate(pool,true);
  process.stdout.write('DripSign migrations applied\n');
} finally { await pool.end(); }
