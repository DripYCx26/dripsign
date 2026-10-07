import 'server-only';
import { createPool, DripSignStore } from '@dripsign/db';
import { getConfiguration } from './config';

let store: DripSignStore | undefined;

/** One bounded database pool owns native web persistence. */
export function getStore(): DripSignStore {
  if (!store) store = new DripSignStore(createPool(getConfiguration().databaseUrl));
  return store;
}
