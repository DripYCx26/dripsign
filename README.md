# DripSign

An open source agreement workspace. Staff prepare an agreement, recipients negotiate in a
turn-based thread beside the document, staff publish immutable revisions, signers sign with a
typed name, and a worker archives the signed PDF and audit record. One Next.js app, one Node
package for everything that decides, PostgreSQL.

[AGENTS.md](AGENTS.md) owns the working contract. [Architecture](docs/ARCHITECTURE.md) describes
the system; [decisions](docs/DECISIONS.md) records what was chosen and why.

## Run it locally

Needs Node >=22.12, pnpm 10 and Docker. Nothing else; no cloud account.

```bash
pnpm install && pnpm dev
```

`pnpm dev` creates `.env` from `.env.example`, starts Postgres and Mailpit with Docker Compose,
applies the schema, seeds an empty database, then runs the web app and the jobs worker.

| What | Where |
|---|---|
| App | http://127.0.0.1:3000 |
| Dev sign-in (no email round trip) | http://127.0.0.1:3000/dev/sign-in |
| Mailpit (every email the app sends) | http://127.0.0.1:8025 |

`pnpm db:reset` wipes the database and reapplies the schema; `pnpm seed` loads the sample data
into an empty one.

## Try the workflows

Every identity is synthetic. Sign in at `/dev/sign-in`.

| Identity | Try |
|---|---|
| `avery@northwind.test` (staff admin) | Create an agreement, publish a revision, request signatures; open the staff dashboard |
| `sam@northwind.test` (staff member) | Accept a recipient proposal and republish the revision |
| `jordan@client.test` (recipient) | Propose a change to "Mutual NDA"; read the thread; open a published revision |
| `morgan@client.test` (recipient) | Sign "Q4 retainer" and download the signed PDF; read the audit record |
| `taylor@client.test` (recipient) | An optional recipient: sees the agreement, is not asked to sign |
| `priya@harbor.test` (staff admin, other tenant) | Tenant isolation: sees none of Northwind's agreements |
| `sam@northwind.test` again | Dual role: also a signer on Harbor Legal's "Speaking engagement"; switch between homes |

The seeded agreements cover every status: draft, in review with a pending proposal, signing,
signed with both artifacts, and void.

## Subdirectories

| Path | What |
|---|---|
| `apps/` | The Next.js web app |
| `packages/` | `core`: schema, domain rules, auth, PDF, adapters, worker and CLI |
| `docs/` | Architecture and dated decisions |
| `infra/` | The container image and what an operator supplies in production |
| `tools/` | Local development and the gate |
| `e2e/` | Browser smoke test |

## Verify

```bash
tools/ci          # static, types, test, build
tools/ci e2e      # browser smoke against pnpm dev
```

Tests use a real PostgreSQL (`docker compose up -d --wait`).

## License

Apache License 2.0; see [LICENSE](LICENSE).
