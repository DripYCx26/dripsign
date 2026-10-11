// The one configuration home, parsed once per process by web instrumentation, worker and CLI.
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

/** The app's user-assigned identity and the local token endpoint Container Apps provides. */
export interface AzureIdentity {
  readonly clientId: string;
  readonly endpoint: string;
  /** Sent only to the identity endpoint. */
  readonly header: string;
}

export type StorageConfig =
  | { readonly kind: "file"; readonly dir: string }
  | {
      readonly kind: "s3";
      readonly bucket: string;
      readonly region: string;
      readonly kmsKeyId: string | null;
    }
  | {
      readonly kind: "azure";
      /** The account blob endpoint, `https://<account>.blob.core.windows.net`. */
      readonly endpoint: string;
      readonly container: string;
      readonly identity: AzureIdentity;
    };

export type EmailConfig =
  | { readonly transport: "smtp"; readonly from: string; readonly smtpUrl: string }
  | { readonly transport: "ses"; readonly from: string; readonly region: string }
  | {
      readonly transport: "azure";
      /** The bare sender address: Communication Services takes no display name. */
      readonly from: string;
      /** The Communication Services endpoint, `https://<resource>.communication.azure.com`. */
      readonly endpoint: string;
      readonly identity: AzureIdentity;
    };

export interface CompletionExportDelivery {
  /** The host's fixed https `/v1/webhooks/dripsign` URL. */
  readonly url: string;
  readonly keys: readonly CompletionKey[];
}

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
  /** Null when no host is configured: the bridge entry is off. */
  readonly host: HostConfig | null;
  /** Null when the URL and keys are unset: no executed event is frozen or delivered. */
  readonly completionExport: CompletionExportDelivery | null;
}

const base64url32 = z.string().regex(/^[A-Za-z0-9_-]{43}$/u, "Expected 32 bytes, base64url");
const hostText = z.string().regex(/^[\x21-\x7e]{1,100}$/u);

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
  tenants: z.array(z.strictObject({ firm: z.uuid(), tenantId: z.uuid() })).min(1),
});

export type HostConfig = z.infer<typeof hostSchema>;
/** A private Ed25519 seed; a retired key stays while a frozen event still names it. */
export type CompletionKey = Readonly<z.infer<typeof completionKeysSchema>[number]>;

/** The executed event's path, fixed by Dreach's receiver. */
export const HOST_EVENT_PATH = "/v1/webhooks/dripsign";

const completionKeysSchema = z
  .array(
    z.strictObject({
      keyId: hostText,
      keyVersion: z.number().int().min(1).max(4_294_967_295),
      seed: z.string().regex(/^[a-f0-9]{64}$/u, "Expected 32 bytes, lowercase hex"),
    }),
  )
  .min(1)
  .max(8)
  .refine(
    (keys) =>
      new Set(keys.map((key) => `${key.keyId}:${String(key.keyVersion)}`)).size === keys.length,
    "Each keyId and keyVersion appears once",
  );

/** Credentials, a query or a fragment in a configured endpoint are refused. */
const bareUrl = (value: string): boolean => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash;
};
const httpsEndpoint = z.url({ protocol: /^https$/u }).refine(bareUrl, "Use a bare https URL");
// Container Apps serves the identity endpoint over plain http on this host's loopback.
const identityEndpoint = z
  .url({ protocol: /^https?$/u })
  .refine(bareUrl, "Use a bare URL")
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || isLoopbackHostname(url.hostname);
  }, "Plain http only on loopback");

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
  DRIPSIGN_STORAGE: z.enum(["file", "s3", "azure"]).default("file"),
  DRIPSIGN_STORAGE_DIR: text,
  DRIPSIGN_S3_BUCKET: text,
  AWS_REGION: text,
  DRIPSIGN_S3_KMS_KEY_ID: text,
  DRIPSIGN_AZURE_BLOB_ENDPOINT: httpsEndpoint.optional(),
  DRIPSIGN_AZURE_BLOB_CONTAINER: z
    .string()
    .regex(/^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/u, "Expected an Azure container name")
    .optional(),
  DRIPSIGN_EMAIL_TRANSPORT: z.enum(["smtp", "ses", "azure"]).default("smtp"),
  DRIPSIGN_EMAIL_FROM: text,
  DRIPSIGN_SMTP_URL: z.url({ protocol: /^smtps?$/u }).optional(),
  DRIPSIGN_AZURE_EMAIL_ENDPOINT: httpsEndpoint.optional(),
  AZURE_CLIENT_ID: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,128}$/u, "Expected a client id")
    .optional(),
  IDENTITY_ENDPOINT: identityEndpoint.optional(),
  IDENTITY_HEADER: text,
  DRIPSIGN_ANTHROPIC_API_KEY: text,
  DRIPSIGN_AI_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  DRIPSIGN_AI_DAILY_LIMIT_USD: z.coerce.number().positive().max(10_000).default(10),
  DRIPSIGN_JOBS_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  DRIPSIGN_HOST: text,
  DRIPSIGN_HOST_EVENT_URL: httpsEndpoint
    .refine((value) => new URL(value).pathname === HOST_EVENT_PATH, `Must end ${HOST_EVENT_PATH}`)
    .optional(),
  DRIPSIGN_COMPLETION_KEYS: text,
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
  const host = parseJson("DRIPSIGN_HOST", env.DRIPSIGN_HOST, hostSchema);
  const keys = parseJson(
    "DRIPSIGN_COMPLETION_KEYS",
    env.DRIPSIGN_COMPLETION_KEYS,
    completionKeysSchema,
  );
  const issues: Issue[] = [...host.issues, ...keys.issues];
  const config = build(env, host.value, keys.value, requirer(env, issues));
  issues.push(...crossFieldIssues(env, config));
  if (issues.length > 0) fail(issues);
  return config;
}

let memo: Config | undefined;

export function loadConfig(): Config {
  memo ??= parseConfig(process.env);
  return memo;
}

function parseJson<T>(
  key: string,
  value: string | undefined,
  schema: z.ZodType<T>,
): { value: T | null; issues: readonly Issue[] } {
  if (value === undefined) return { value: null, issues: [] };
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    return { value: null, issues: [[key, "Must be JSON"]] };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { value: parsed.data, issues: [] };
  return {
    value: null,
    issues: parsed.error.issues.map((issue) => [key, `${issue.path.join(".")}: ${issue.message}`]),
  };
}

/** Reads a key the chosen provider needs; a missing one is reported once and parsing fails. */
type Need = (key: keyof Env, use: string) => string;

function requirer(env: Env, issues: Issue[]): Need {
  return (key, use) => {
    const value = env[key];
    if (typeof value === "string") return value;
    if (!issues.some(([reported]) => reported === key)) issues.push([key, `Required for ${use}`]);
    return "";
  };
}

function crossFieldIssues(env: Env, config: Config): Issue[] {
  const issues: Issue[] = [];
  const { production } = config;
  const origin = new URL(config.publicOrigin);
  if (config.devLogin && (production || !isLoopbackHostname(origin.hostname))) {
    issues.push(["DRIPSIGN_DEV_LOGIN", "Only allowed outside production with a loopback origin"]);
  }
  if (production && origin.protocol !== "https:") {
    issues.push(["DRIPSIGN_PUBLIC_ORIGIN", "Production requires https"]);
  }
  if (production && config.storage.kind === "file") {
    issues.push(["DRIPSIGN_STORAGE", "Production requires s3 or azure"]);
  }
  if (production && config.email.transport === "smtp") {
    issues.push(["DRIPSIGN_EMAIL_TRANSPORT", "Production requires ses or azure"]);
  }
  if (production && !env.DRIPSIGN_EMAIL_FROM) {
    issues.push(["DRIPSIGN_EMAIL_FROM", "Required in production"]);
  } else if (config.email.transport === "azure" && config.email.from === "") {
    issues.push(["DRIPSIGN_EMAIL_FROM", "Azure email needs an address on a connected domain"]);
  }
  return [...issues, ...integrationIssues(env, config)];
}

function integrationIssues(env: Env, config: Config): Issue[] {
  const issues: Issue[] = [];
  if (config.production && config.host && !config.host.origin.startsWith("https://")) {
    issues.push(["DRIPSIGN_HOST", "Production requires an https host origin"]);
  }
  const firms = new Set(config.host?.tenants.map((tenant) => tenant.firm));
  if (config.host && firms.size !== config.host.tenants.length) {
    issues.push(["DRIPSIGN_HOST", "Each firm maps to one tenant"]);
  }
  const urlMissing = env.DRIPSIGN_HOST_EVENT_URL === undefined;
  if (urlMissing !== (env.DRIPSIGN_COMPLETION_KEYS === undefined)) {
    const missing = urlMissing ? "DRIPSIGN_HOST_EVENT_URL" : "DRIPSIGN_COMPLETION_KEYS";
    issues.push([missing, "Set the event URL and the completion keys together"]);
  }
  return issues;
}

function build(
  env: Env,
  host: HostConfig | null,
  completionKeys: readonly CompletionKey[] | null,
  need: Need,
): Config {
  return {
    nodeEnv: env.NODE_ENV,
    production: env.NODE_ENV === "production",
    databaseUrl: env.DRIPSIGN_DATABASE_URL,
    publicOrigin: new URL(env.DRIPSIGN_PUBLIC_ORIGIN).origin,
    authSecret: env.DRIPSIGN_AUTH_SECRET,
    trustedProxyHops: env.DRIPSIGN_TRUSTED_PROXY_HOPS,
    devLogin: env.DRIPSIGN_DEV_LOGIN === "1",
    storage: buildStorage(env, need),
    email: buildEmail(env, need),
    ai: env.DRIPSIGN_ANTHROPIC_API_KEY
      ? {
          apiKey: env.DRIPSIGN_ANTHROPIC_API_KEY,
          model: env.DRIPSIGN_AI_MODEL,
          dailyLimitUsd: env.DRIPSIGN_AI_DAILY_LIMIT_USD,
        }
      : null,
    jobsConcurrency: env.DRIPSIGN_JOBS_CONCURRENCY,
    host,
    completionExport:
      env.DRIPSIGN_HOST_EVENT_URL && completionKeys
        ? { url: env.DRIPSIGN_HOST_EVENT_URL, keys: completionKeys }
        : null,
  };
}

function azureIdentity(need: Need): AzureIdentity {
  const use = "an azure provider";
  return {
    clientId: need("AZURE_CLIENT_ID", use),
    endpoint: need("IDENTITY_ENDPOINT", use),
    header: need("IDENTITY_HEADER", use),
  };
}

function buildStorage(env: Env, need: Need): StorageConfig {
  switch (env.DRIPSIGN_STORAGE) {
    case "file":
      return { kind: "file", dir: workspacePath(need("DRIPSIGN_STORAGE_DIR", "file storage")) };
    case "s3":
      return {
        kind: "s3",
        bucket: need("DRIPSIGN_S3_BUCKET", "s3 storage"),
        region: need("AWS_REGION", "s3 storage"),
        kmsKeyId: env.DRIPSIGN_S3_KMS_KEY_ID ?? null,
      };
    case "azure":
      return {
        kind: "azure",
        endpoint: need("DRIPSIGN_AZURE_BLOB_ENDPOINT", "azure storage"),
        container: need("DRIPSIGN_AZURE_BLOB_CONTAINER", "azure storage"),
        identity: azureIdentity(need),
      };
  }
}

function buildEmail(env: Env, need: Need): EmailConfig {
  const from = env.DRIPSIGN_EMAIL_FROM ?? DEV_EMAIL_FROM;
  switch (env.DRIPSIGN_EMAIL_TRANSPORT) {
    case "smtp":
      return { transport: "smtp", from, smtpUrl: env.DRIPSIGN_SMTP_URL ?? DEV_SMTP_URL };
    case "ses":
      return { transport: "ses", from, region: need("AWS_REGION", "ses email") };
    case "azure":
      return {
        transport: "azure",
        from: senderAddress(from),
        endpoint: need("DRIPSIGN_AZURE_EMAIL_ENDPOINT", "azure email"),
        identity: azureIdentity(need),
      };
  }
}

/** The address of `Name <address>` or of a bare address; empty when neither parses. */
function senderAddress(from: string): string {
  const address = /<([^<>]+)>$/u.exec(from.trim())?.[1] ?? from.trim();
  return z.email().safeParse(address).success ? address : "";
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
