# .github/

Hosted checks.

| Path | What |
|---|---|
| `workflows/` | `ci.yml`: job `gate` runs `tools/ci` static, types, the Vitest suite against a Postgres service, and the web build |

## Controls

Actions are pinned to commit SHAs with the version in a comment. Checkouts disable persisted
credentials. pnpm comes from the `packageManager` field through corepack. Branch protection
should require `gate`.
