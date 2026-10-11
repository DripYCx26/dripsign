# packages/core/

**Job:** everything that decides: schema, domain rules, auth, PDF, storage and email adapters,
the jobs worker and the CLI. Next-free; web imports it as `@dripsign/core/<path>`.

## Subdirectories

| Path | What |
|---|---|
| `schema/` | `schema.sql`, the one baseline schema, edited in place |
| `assets/` | The one font, used for PDF text and the signature preview |
| `src/` | `config.ts`, `db.ts`, `errors.ts`, `schema.ts`, `types.ts`, `cli.ts`, `seed.ts` |
| `src/domain/` | Policy, commands, views, receipts, revisions and signing |
| `src/auth/` | Email codes, sessions, rate limits, capacity resolution |
| `src/host/` | Ed25519 entry assertion and executed event |
| `src/jobs/` | Outbox, runner, handlers, mail, sweep, worker entry |
| `src/adapters/` | Storage (file, S3), email (SMTP, SES), Anthropic |
| `src/pdf/` | Font, rendering, preparation, signed PDF and audit record |

## Commands

```bash
pnpm --filter @dripsign/core cli migrate | reset | seed [--if-empty] | add-staff
pnpm --filter @dripsign/core worker
```

`migrate` applies the baseline to an empty database and refuses a stale one; `reset` is
development only; `add-staff` is the only way to add staff.

## Rules

| Rule | Home |
|---|---|
| Lifecycle and permissions | `src/domain/policy.ts` |
| Validation and limits | `src/schema.ts` |
| Configuration | `src/config.ts` |
| Evidence immutability, round state machine | triggers in `schema/schema.sql` |
| Idempotency | `src/domain/receipts.ts`, one table |

Imports inside the package are relative with `.ts` extensions. Tests use a real PostgreSQL.
[Architecture](../../docs/ARCHITECTURE.md) · [Decisions](../../docs/DECISIONS.md)
