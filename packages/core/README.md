# packages/core/

**Job:** everything that decides: schema, domain rules, auth, PDF, storage and email adapters,
the jobs worker and the CLI. Next-free; web imports it as `@dripsign/core/<path>`.

## Subdirectories

| Path | What |
|---|---|
| `schema/` | `schema.sql`, the one baseline schema, edited in place |
| `assets/` | Noto Sans for PDF text; Newsreader Italic for signatures, with Noto Sans as the fallback |
| `src/` | `config.ts`, `db.ts`, `errors.ts`, `schema.ts`, `types.ts`, `cli.ts`, `seed.ts`; `seed/` holds the demo cast and script |
| `src/domain/` | Policy, commands, views, receipts, revisions, signing, staff roster |
| `src/auth/` | Email codes, sessions, rate limits, capacity resolution |
| `src/host/` | Ed25519 entry assertion for the host bridge |
| `src/jobs/` | Outbox, runner, handlers, mail, sweep, worker entry |
| `src/adapters/` | Storage (file, S3, Azure Blob), email (SMTP, SES, Azure), Anthropic |
| `src/pdf/` | Font, rendering, preparation of written terms, signed PDF and audit record |

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

## Drafting

A starter agreement may have no recipients: its private draft still prepares a PDF. Publishing
waits for a required signer; adding recipients does not require creating another agreement.

The optional staff-private assistant has two explicit modes: `plan` is the conversation before
drafting and returns a summary, questions, whether it offers a legal check, and an outline (empty
while it is still asking); `draft` returns complete terms, a summary and questions. Only a ready
draft can be applied, and only while its base source still matches; staff review and publish
separately. Each request reserves the mode's spend against the tenant's daily limit before
enqueuing one provider call. The latest bounded history contains summaries, headings and
questions, not earlier full draft terms.

[Architecture](../../docs/ARCHITECTURE.md) · [Decisions](../../docs/DECISIONS.md)
