import 'server-only';
import { z } from 'zod';
import { hostKey } from './staffAssertion';
import type { BridgeTrust } from './staffAssertion';

const issuerSchema = z.strictObject({
  issuer: z.string().min(1).max(100), audience: z.string().min(1).max(100),
  secret: z.string().min(32).max(4096),
});
const staffSchema = z.strictObject({
  tenantId: z.uuid(), tenantName: z.string().min(1).max(200),
  userId: z.string().min(1).max(200), email: z.email().max(320),
});
const environmentSchema = z.strictObject({
  databaseUrl: z.string().url(), publicOrigin: z.string().url(),
  isAdmissionPaused: z.boolean(), authSecret: z.string().min(32).max(4096), bridgeIssuers: z.array(issuerSchema).max(20),
  staffMemberships: z.array(staffSchema).max(100),
});
type Configuration = z.infer<typeof environmentSchema> & { readonly staffBridge: BridgeTrust | null };
let configuration: Configuration | undefined;

function privateJson(name: string): unknown {
  try { return JSON.parse(process.env[name] ?? '[]') as unknown; }
  catch { throw new Error(`Invalid private configuration: ${name}`); }
}

function exactHttpsOrigin(value: string, name: string): string {
  const origin = new URL(value);
  const isDevelopmentLoopback = process.env.NODE_ENV !== 'production'
    && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !isDevelopmentLoopback) || origin.origin !== value) {
    throw new Error(`${name} must be an exact HTTPS origin`);
  }
  return value;
}

/** The staff session bridge needs both the host origin and its public key, or neither. */
function staffBridge(publicOrigin: string): BridgeTrust | null {
  const keys = process.env.DRIPSIGN_BRIDGE_PUBLIC_KEY;
  const host = process.env.DRIPSIGN_BRIDGE_HOST_ORIGIN;
  if (!keys && !host) return null;
  if (!keys || !host) throw new Error('DRIPSIGN_BRIDGE_PUBLIC_KEY and DRIPSIGN_BRIDGE_HOST_ORIGIN go together');
  const hostOrigin = exactHttpsOrigin(host, 'DRIPSIGN_BRIDGE_HOST_ORIGIN');
  const parsed = keys.split(',').map(hostKey);
  // One key, or two while a host rotates to a new one.
  if (parsed.length > 2 || hostOrigin === publicOrigin) throw new Error('Invalid staff bridge configuration');
  return { hostOrigin, audience: publicOrigin, keys: parsed };
}

/** Validate private deployment configuration before accepting authenticated traffic. */
export function getConfiguration(): Configuration {
  if (configuration) return configuration;
  const candidate = environmentSchema.parse({
    databaseUrl: process.env.DRIPSIGN_DATABASE_URL,
    publicOrigin: process.env.DRIPSIGN_PUBLIC_ORIGIN,
    authSecret: process.env.DRIPSIGN_AUTH_SECRET,
    isAdmissionPaused: z.enum(['0', '1']).parse(process.env.DRIPSIGN_ADMISSION_PAUSED ?? '0') === '1',
    bridgeIssuers: privateJson('DRIPSIGN_BRIDGE_ISSUERS'),
    staffMemberships: privateJson('DRIPSIGN_STAFF_MEMBERSHIPS'),
  });
  exactHttpsOrigin(candidate.publicOrigin, 'DRIPSIGN_PUBLIC_ORIGIN');
  configuration = { ...candidate, staffBridge: staffBridge(candidate.publicOrigin) };
  return configuration;
}
