import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

const MAX_TEST_WORKERS = 4;

// Domain, job and auth tests use real Postgres: globalSetup recreates `dripsign_test` once.
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/web/src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    globalSetup: ["tools/test-db.mjs"],
    maxWorkers: Math.min(MAX_TEST_WORKERS, Math.max(1, availableParallelism() - 1)),
  },
});
