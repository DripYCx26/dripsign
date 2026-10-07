import type { OutboxAdmission } from '@dripsign/db';

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing worker configuration: ${key}`);
  return value;
}

function boundedInteger(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const value = Number(env[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid worker configuration: ${key}`);
  }
  return value;
}

/** Reads private runtime configuration and rejects invalid operational bounds. */
export function readConfiguration(env: NodeJS.ProcessEnv): {
  readonly databaseUrl: string;
  readonly region: string;
  readonly bucket: string;
  readonly kmsKeyId: string | undefined;
  readonly emailFrom: string;
  readonly publicOrigin: string;
  readonly anthropicKey: string;
  readonly hostEventUrl: URL;
  readonly hostEventSecret: string;
  readonly concurrency: number;
  readonly pollMs: number;
  readonly admission: OutboxAdmission;
  readonly recoveryOnly: boolean;
} {
  const hostEventUrl = new URL(required(env, 'DRIPSIGN_HOST_EVENT_URL'));
  if (hostEventUrl.protocol !== 'https:' || hostEventUrl.username || hostEventUrl.password || hostEventUrl.hash) {
    throw new Error('Invalid worker configuration: DRIPSIGN_HOST_EVENT_URL');
  }
  const hostEventSecret = required(env, 'DRIPSIGN_HOST_EVENT_SECRET');
  const publicUrl = new URL(required(env, 'DRIPSIGN_PUBLIC_ORIGIN'));
  if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.href !== `${publicUrl.origin}/`) {
    throw new Error('Invalid worker configuration: DRIPSIGN_PUBLIC_ORIGIN');
  }
  if (Buffer.byteLength(hostEventSecret) < 32) throw new Error('Host event signing secret is too short');
  if (env['DRIPSIGN_RECOVERY_ONLY'] !== undefined && env['DRIPSIGN_RECOVERY_ONLY'] !== '0' && env['DRIPSIGN_RECOVERY_ONLY'] !== '1') {
    throw new Error('Invalid worker configuration: DRIPSIGN_RECOVERY_ONLY');
  }
  return {
    databaseUrl: required(env, 'DRIPSIGN_DATABASE_URL'),
    region: required(env, 'AWS_REGION'),
    bucket: required(env, 'DRIPSIGN_DOCUMENT_BUCKET'),
    kmsKeyId: env['DRIPSIGN_KMS_KEY_ID']?.trim() || undefined,
    emailFrom: required(env, 'DRIPSIGN_EMAIL_FROM'),
    publicOrigin: publicUrl.origin,
    recoveryOnly: env['DRIPSIGN_RECOVERY_ONLY'] === '1',
    anthropicKey: required(env, 'ANTHROPIC_API_KEY'),
    hostEventUrl,
    hostEventSecret,
    // ASSUMPTION: a small initial process limit; durable admission is owned by the database.
    concurrency: boundedInteger(env, 'DRIPSIGN_JOBS_CONCURRENCY', 2, 1, 4),
    pollMs: boundedInteger(env, 'DRIPSIGN_JOBS_POLL_MS', 1_000, 250, 30_000),
    // ASSUMPTION: pilot admission ceilings ratified by the service owner; operators may lower them.
    admission: {
      globalConcurrency: boundedInteger(env, 'DRIPSIGN_JOBS_GLOBAL_CONCURRENCY', 4, 1, 4),
      tenantConcurrency: boundedInteger(env, 'DRIPSIGN_JOBS_TENANT_CONCURRENCY', 2, 1, 2),
      globalPerMinute: boundedInteger(env, 'DRIPSIGN_JOBS_GLOBAL_PER_MINUTE', 60, 1, 60),
      tenantPerMinute: boundedInteger(env, 'DRIPSIGN_JOBS_TENANT_PER_MINUTE', 20, 1, 20),
    },
  };
}
