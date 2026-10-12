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
| `avery@northwind.test` (staff admin) | Create an agreement, publish a revision, request signatures; answer Jordan's counter on "Mutual NDA"; open the team page |
| `sam@northwind.test` (staff member) | Open "Photography license", where Sam's proposal awaits Morgan; republish after an accepted change |
| `jordan@client.test` (recipient) | Counter on "Mutual NDA"; propose a change to "Logo design brief"; read the signed "Office sublease" and its audit record |
| `morgan@client.test` (recipient) | Decide Sam's proposal on "Photography license"; sign "Q4 retainer"; download the signed PDF |
| `taylor@client.test` (recipient) | An optional recipient: sees the agreements, is never asked to sign |
| `priya@harbor.test` (staff admin, other tenant) | Tenant isolation: sees none of Northwind's agreements |
| `sam@northwind.test` again | Dual role: also the signer on Harbor Legal's "Speaking engagement"; switch between homes |

The eight seeded agreements cover every status:

| Agreement | State |
|---|---|
| Website redesign services | Draft |
| Mutual NDA | In review; Jordan's counter on the term is pending |
| Photography license | In review; Sam's proposal is pending |
| Logo design brief | In review; nothing proposed |
| Q4 retainer | Signing; Jordan signed, Morgan has not |
| Office sublease | Signed, both artifacts archived |
| Equipment lease | Void |
| Speaking engagement (Harbor Legal) | Signing; Sam has not signed |

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
