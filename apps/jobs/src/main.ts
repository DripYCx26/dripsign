import { createPool, DripSignStore } from '@dripsign/db';
import { readConfiguration } from './config.ts';
import { JobEffects } from './effects.ts';
import { logMetadata } from './metadataLog.ts';
import { runJobs } from './runner.ts';

async function main(): Promise<void> {
  const configuration = readConfiguration(process.env);
  const pool = createPool(configuration.databaseUrl);
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    const store = new DripSignStore(pool);
    const effects = new JobEffects(store, configuration);
    await runJobs(store, (message) => effects.dispatch(message), configuration.concurrency,
      configuration.pollMs, configuration.admission, configuration.recoveryOnly, controller.signal);
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await pool.end();
  }
}

main().catch(() => {
  logMetadata({ event: 'failure', code: 'worker_stopped' });
  process.exitCode = 1;
});
