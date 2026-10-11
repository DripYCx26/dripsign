// Vitest globalSetup: recreates the `dripsign_test` database once per run from
// packages/core/schema/schema.sql and exports the minimal valid dev environment the tests load.
// The database name must end in `_test`; the script drops it, so it refuses anything else.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_URL = "postgres://dripsign:dripsign@127.0.0.1:5433/dripsign_test";
const SCHEMA = path.join(ROOT, "packages/core/schema/schema.sql");

const require = createRequire(path.join(ROOT, "packages/core/package.json"));
const { Client } = require("pg");

// Through Docker's published port the server's FIN never reaches the client, so `end()` alone
// hangs; destroy the socket if the graceful close has not finished quickly.
const CLOSE_GRACE_MS = 500;
async function close(client) {
  const timer = setTimeout(() => client.connection.stream.destroy(), CLOSE_GRACE_MS);
  try {
    await client.end();
  } finally {
    clearTimeout(timer);
  }
}

const quote = (name) => `"${name.replaceAll('"', '""')}"`;

export default async function setup() {
  const testUrl = process.env.DRIPSIGN_TEST_DATABASE_URL ?? DEFAULT_URL;
  const name = decodeURIComponent(new URL(testUrl).pathname.slice(1));
  if (!/^[A-Za-z0-9_]+_test$/u.test(name)) {
    throw new Error(`DRIPSIGN_TEST_DATABASE_URL must name a database ending in _test, got "${name}"`);
  }
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";

  const admin = new Client({ connectionString: adminUrl.href });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${quote(name)}`);
  } finally {
    await close(admin);
  }

  const schema = readFileSync(SCHEMA, "utf8");
  const client = new Client({ connectionString: testUrl });
  await client.connect();
  try {
    await client.query(schema);
  } finally {
    await close(client);
  }

  const storageDir = mkdtempSync(path.join(tmpdir(), "dripsign-test-storage-"));
  Object.assign(process.env, {
    DRIPSIGN_DATABASE_URL: testUrl,
    DRIPSIGN_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
    DRIPSIGN_AUTH_SECRET: "test-auth-secret-0123456789abcdef0123456789abcdef",
    DRIPSIGN_STORAGE: "file",
    DRIPSIGN_STORAGE_DIR: storageDir,
    DRIPSIGN_EMAIL_TRANSPORT: "smtp",
    DRIPSIGN_SMTP_URL: "smtp://127.0.0.1:1025",
    DRIPSIGN_EMAIL_FROM: "DripSign <no-reply@dripsign.test>",
  });

  return () => rmSync(storageDir, { recursive: true, force: true });
}
