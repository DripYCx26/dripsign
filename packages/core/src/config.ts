// The one configuration home, parsed once per process by web instrumentation, worker and CLI.
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

export type StorageConfig =
  | { readonly kind: "file"; readonly dir: string }
  | {
      readonly kind: "s3";
      readonly bucket: string;
      readonly region: string;
      readonly kmsKeyId: string | null;
    };

export type EmailConfig =
  | { readonly transport: "smtp"; readonly from: string; readonly smtpUrl: string }
  | { readonly transport: "ses"; readonly from: string; readonly region: string };

export interface AiConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly dailyLimitUsd: number;
}

export interface Config {
  readonly nodeEnv: "development" | "test" | "production";
  readonly production: boolean;
  readonly databaseUrl: string;
  /** Scheme, host and port only, no trailing slash. */
  readonly publicOrigin: string;
  readonly authSecret: string;
  readonly trustedProxyHops: number;
  readonly devLogin: boolean;
  readonly storage: StorageConfig;
  readonly email: EmailConfig;
  /** Null when no API key is set: the assistant is hidden. */
  readonly ai: AiConfig | null;
  readonly jobsConcurrency: number;
  /** Null when no host is configured: bridge entry and executed events are off. */
  readonly host: HostConfig | null;
  readonly hostEventSeed: string | null;
}

const base64url32 = z.string().regex(/^[A-Za-z0-9_-]{43}$/u, "Expected 32 bytes, base64url");
const hostText = z.string().regex(/^[\x21-\x7e]{1,100}$/u);

const hostEventSchema = z.strictObject({
  url: z.url({ protocol: /^https?$/u }),
  issuer: hostText,
  audience: hostText,
  keyId: hostText,
  keyVersion: z.number().int().positive(),
  senderBindingId: z.uuid(),
  senderBindingRevision: z.number().int().positive(),
  senderGrantId: z.uuid(),
  hostTenantId: z.uuid(),
});

const hostSchema = z.strictObject({
  origin: z.url({ protocol: /^https?$/u }),
  entry: z.strictObject({
    issuer: hostText,
    audience: hostText,
    keys: z
      .array(z.strictObject({ kid: hostText, publicKey: base64url32 }))
      .min(1)
      .max(5),
  }),
  tenants: z
    .array(
      z.strictObject({
        firm: z.uuid(),
        tenantId: z.uuid(),
        event: hostEventSchema.nullable(),
      }),
    )
    .min(1),
});

export type HostConfig = z.infer<typeof hostSchema>;

const text = z.string().min(1).optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DRIPSIGN_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/u }),
  DRIPSIGN_PUBLIC_ORIGIN: z
    .url({ protocol: /^https?$/u })
    .refine((value) => new URL(value).origin === value.replace(/\/$/u, ""), "Use an origin only"),
  DRIPSIGN_AUTH_SECRET: z
    .string()
    .refine((value) => Buffer.byteLength(value) >= 32, "Must be at least 32 bytes"),
  DRIPSIGN_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  DRIPSIGN_DEV_LOGIN: z.enum(["0", "1"]).default("0"),
  DRIPSIGN_STORAGE: z.enum(["file", "s3"]).default("file"),
  DRIPSIGN_STORAGE_DIR: text,
  DRIPSIGN_S3_BUCKET: text,
  AWS_REGION: text,
  DRIPSIGN_S3_KMS_KEY_ID: text,
  DRIPSIGN_EMAIL_TRANSPORT: z.enum(["smtp", "ses"]).default("smtp"),
  DRIPSIGN_EMAIL_FROM: text,
  DRIPSIGN_SMTP_URL: z.url({ protocol: /^smtps?$/u }).optional(),
  DRIPSIGN_ANTHROPIC_API_KEY: text,
  DRIPSIGN_AI_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  DRIPSIGN_AI_DAILY_LIMIT_USD: z.coerce.number().positive().max(10_000).default(10),
  DRIPSIGN_JOBS_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  DRIPSIGN_HOST: text,
  DRIPSIGN_HOST_EVENT_SEED: base64url32.optional(),
});

type Env = z.infer<typeof envSchema>;
type Issue = readonly [key: string, message: string];

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DEV_EMAIL_FROM = "DripSign <no-reply@dripsign.test>";
const DEV_SMTP_URL = "smtp://127.0.0.1:1025";

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/** Pure: parses an environment record. Throws one Error naming every invalid key. */
export function parseConfig(raw: Readonly<Record<string, string | undefined>>): Config {
  // Blank lines in .env files mean "unset".
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ""));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    fail(parsed.error.issues.map((issue) => [String(issue.path[0] ?? "env"), issue.message]));
  }
  const env = parsed.data;
  const host = parseHost(env.DRIPSIGN_HOST);
  const issues = [...host.issues, ...crossFieldIssues(env, host.value)];
  if (issues.length > 0) fail(issues);
  return build(env, host.value);
}

let memo: Config | undefined;

export function loadConfig(): Config {
  memo ??= parseConfig(process.env);
  return memo;
}

function parseHost(value: string | undefined): {
  value: HostConfig | null;
  issues: readonly Issue[];
} {
  if (value === undefined) return { value: null, issues: [] };
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    return { value: null, issues: [["DRIPSIGN_HOST", "Must be JSON"]] };
  }
  const parsed = hostSchema.safeParse(json);
  if (parsed.success) return { value: parsed.data, issues: [] };
  return {
    value: null,
    issues: parsed.error.issues.map((issue) => [
      "DRIPSIGN_HOST",
      `${issue.path.join(".")}: ${issue.message}`,
    ]),
  };
}

function crossFieldIssues(env: Env, host: HostConfig | null): Issue[] {
  const issues: Issue[] = [];
  const production = env.NODE_ENV === "production";
  const origin = new URL(env.DRIPSIGN_PUBLIC_ORIGIN);
  if (env.DRIPSIGN_DEV_LOGIN === "1" && (production || !isLoopbackHostname(origin.hostname))) {
    issues.push(["DRIPSIGN_DEV_LOGIN", "Only allowed outside production with a loopback origin"]);
  }
  if (production && origin.protocol !== "https:") {
    issues.push(["DRIPSIGN_PUBLIC_ORIGIN", "Production requires https"]);
  }
  issues.push(
    ...storageIssues(env, production),
    ...emailIssues(env, production),
    ...hostIssues(env, host, production),
  );
  return issues;
}

function storageIssues(env: Env, production: boolean): Issue[] {
  const issues: Issue[] = [];
  if (env.DRIPSIGN_STORAGE === "file") {
    if (production) issues.push(["DRIPSIGN_STORAGE", "Production requires s3"]);
    if (!env.DRIPSIGN_STORAGE_DIR)
      issues.push(["DRIPSIGN_STORAGE_DIR", "Required for file storage"]);
    return issues;
  }
  if (!env.DRIPSIGN_S3_BUCKET) issues.push(["DRIPSIGN_S3_BUCKET", "Required for s3 storage"]);
  if (!env.AWS_REGION) issues.push(["AWS_REGION", "Required for s3 storage"]);
  return issues;
}

function emailIssues(env: Env, production: boolean): Issue[] {
  const issues: Issue[] = [];
  if (env.DRIPSIGN_EMAIL_TRANSPORT === "smtp" && production) {
    issues.push(["DRIPSIGN_EMAIL_TRANSPORT", "Production requires ses"]);
  }
  // s3 storage already reports a missing AWS_REGION once.
  if (env.DRIPSIGN_EMAIL_TRANSPORT === "ses" && !env.AWS_REGION && env.DRIPSIGN_STORAGE !== "s3") {
    issues.push(["AWS_REGION", "Required for ses email"]);
  }
  if (production && !env.DRIPSIGN_EMAIL_FROM) {
    issues.push(["DRIPSIGN_EMAIL_FROM", "Required in production"]);
  }
  return issues;
}

function hostIssues(env: Env, host: HostConfig | null, production: boolean): Issue[] {
  if (host === null) return [];
  const issues: Issue[] = [];
  const urls = [host.origin, ...host.tenants.flatMap((tenant) => tenant.event?.url ?? [])];
  if (production && urls.some((url) => !url.startsWith("https://"))) {
    issues.push(["DRIPSIGN_HOST", "Production requires https host URLs"]);
  }
  if (host.tenants.some((tenant) => tenant.event !== null) && !env.DRIPSIGN_HOST_EVENT_SEED) {
    issues.push(["DRIPSIGN_HOST_EVENT_SEED", "Required when a host tenant receives events"]);
  }
  if (new Set(host.tenants.map((tenant) => tenant.firm)).size !== host.tenants.length) {
    issues.push(["DRIPSIGN_HOST", "Each firm maps to one tenant"]);
  }
  return issues;
}

function build(env: Env, host: HostConfig | null): Config {
  const production = env.NODE_ENV === "production";
  return {
    nodeEnv: env.NODE_ENV,
    production,
    databaseUrl: env.DRIPSIGN_DATABASE_URL,
    publicOrigin: new URL(env.DRIPSIGN_PUBLIC_ORIGIN).origin,
    authSecret: env.DRIPSIGN_AUTH_SECRET,
    trustedProxyHops: env.DRIPSIGN_TRUSTED_PROXY_HOPS,
    devLogin: env.DRIPSIGN_DEV_LOGIN === "1",
    storage: buildStorage(env),
    email: buildEmail(env),
    ai: env.DRIPSIGN_ANTHROPIC_API_KEY
      ? {
          apiKey: env.DRIPSIGN_ANTHROPIC_API_KEY,
          model: env.DRIPSIGN_AI_MODEL,
          dailyLimitUsd: env.DRIPSIGN_AI_DAILY_LIMIT_USD,
        }
      : null,
    jobsConcurrency: env.DRIPSIGN_JOBS_CONCURRENCY,
    host,
    hostEventSeed: env.DRIPSIGN_HOST_EVENT_SEED ?? null,
  };
}

// crossFieldIssues has already refused missing values, so the `?? ''` fallbacks never apply.
function buildStorage(env: Env): StorageConfig {
  if (env.DRIPSIGN_STORAGE === "file") {
    return { kind: "file", dir: workspacePath(env.DRIPSIGN_STORAGE_DIR ?? "") };
  }
  return {
    kind: "s3",
    bucket: env.DRIPSIGN_S3_BUCKET ?? "",
    region: env.AWS_REGION ?? "",
    kmsKeyId: env.DRIPSIGN_S3_KMS_KEY_ID ?? null,
  };
}

function buildEmail(env: Env): EmailConfig {
  const from = env.DRIPSIGN_EMAIL_FROM ?? DEV_EMAIL_FROM;
  if (env.DRIPSIGN_EMAIL_TRANSPORT === "ses") {
    return { transport: "ses", from, region: env.AWS_REGION ?? "" };
  }
  return { transport: "smtp", from, smtpUrl: env.DRIPSIGN_SMTP_URL ?? DEV_SMTP_URL };
}

/** Web runs in apps/web and the worker in packages/core: relative paths resolve from the workspace root. */
function workspacePath(path: string): string {
  if (isAbsolute(path)) return path;
  let dir = process.cwd();
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) return resolve(process.cwd(), path);
    dir = parent;
  }
  return resolve(dir, path);
}

function fail(issues: readonly Issue[]): never {
  const lines = issues.map(([key, message]) => `- ${key}: ${message}`);
  throw new Error(`Invalid DripSign configuration:\n${lines.join("\n")}`);
}
