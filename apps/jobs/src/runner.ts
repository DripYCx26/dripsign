import { setTimeout as delay } from 'node:timers/promises';
import type { DripSignStore, OutboxAdmission, OutboxMessage } from '@dripsign/db';
import { logMetadata } from './metadataLog.ts';

// ASSUMPTION: the lease exceeds the bounded provider read, download, and archive sequence.
const LEASE_MS = 300_000;
// ASSUMPTION: this bounded fair page avoids polling every tenant while global admission is full.
const TENANT_PAGE_SIZE = 16;

/** Claims only available process capacity, drains in-flight work on shutdown, and leaves recovery to durable leases. */
export async function runJobs(
  store: DripSignStore,
  dispatch: (message: OutboxMessage) => Promise<void>,
  concurrency: number,
  pollMs: number,
  admission: OutboxAdmission,
  recoveryOnly: boolean,
  signal: AbortSignal,
): Promise<void> {
  logMetadata({ event: 'started' });
  while (!signal.aborted) {
    const tenants = await store.listOutboxTenants(TENANT_PAGE_SIZE, recoveryOnly);
    const claimed: OutboxMessage[] = [];
    for (const tenantId of tenants) {
      if (signal.aborted || claimed.length >= concurrency) break;
      claimed.push(...await store.claimOutbox(tenantId, 1, LEASE_MS, admission, recoveryOnly));
    }
    if (claimed.length) {
      logMetadata({ event: 'claimed', count: claimed.length });
      // Every dispatch handles its own typed outcome; all siblings must drain even after an infrastructure error.
      const results = await Promise.allSettled(claimed.map(dispatch));
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('A worker job could not persist its outcome');
      }
      continue;
    }
    try { await delay(pollMs, undefined, { signal }); }
    catch (error: unknown) { if (!signal.aborted) throw error; }
  }
  logMetadata({ event: 'stopped' });
}
