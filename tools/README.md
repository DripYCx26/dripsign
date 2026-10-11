# tools/

**Job:** local development and the gate. Plain ESM on `node:` built-ins and Bash; no npm
dependency beyond what the workspace installs. Each script's header comment states its purpose.

| Script | What it does |
|---|---|
| `dev.mjs` | `pnpm dev`: creates `.env`, starts Postgres and Mailpit, migrates and seeds, runs web and worker |
| `ci` | The gate: `static`, `types`, `test`, `build`, `e2e`; no argument runs all but `e2e` |
| `check-docs.mjs` | READMEs exist, listed directories exist, links resolve, `AGENTS.md` stays short, config keys are in `.env.example` |
| `test-db.mjs` | Vitest globalSetup: recreates `dripsign_test` from `packages/core/schema/schema.sql` and sets test env |
| `*.test.mjs` | `node --test` suites for the scripts above |

## Rules here

Register every check in `ci`. Tool tests plant throwaway trees under the OS temp directory.
