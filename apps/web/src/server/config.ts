import 'server-only';
import { z } from 'zod';

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
let configuration: z.infer<typeof environmentSchema> | undefined;

function privateJson(name: string): unknown {
  try { return JSON.parse(process.env[name] ?? '[]') as unknown; }
  catch { throw new Error(`Invalid private configuration: ${name}`); }
}

/** Validate private deployment configuration before accepting authenticated traffic. */
export function getConfiguration(): z.infer<typeof environmentSchema> {
  if (configuration) return configuration;
  const candidate = environmentSchema.parse({
    databaseUrl: process.env.DRIPSIGN_DATABASE_URL,
    publicOrigin: process.env.DRIPSIGN_PUBLIC_ORIGIN,
    authSecret: process.env.DRIPSIGN_AUTH_SECRET,
    isAdmissionPaused: z.enum(['0', '1']).parse(process.env.DRIPSIGN_ADMISSION_PAUSED ?? '0') === '1',
    bridgeIssuers: privateJson('DRIPSIGN_BRIDGE_ISSUERS'),
    staffMemberships: privateJson('DRIPSIGN_STAFF_MEMBERSHIPS'),
  });
  const origin = new URL(candidate.publicOrigin);
  const isDevelopmentLoopback = process.env.NODE_ENV !== 'production'
    && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !isDevelopmentLoopback) || origin.origin !== candidate.publicOrigin) {
    throw new Error('DRIPSIGN_PUBLIC_ORIGIN must be an exact HTTPS origin');
  }
  configuration = candidate;
  return configuration;
}
