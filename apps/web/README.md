# apps/web/

**Job:** present and transport: pages, server actions and three route handlers for the staff
workspace, recipient portal and signing flow. Decisions live in `packages/core`.

## Routes

| Route | Who can reach it |
|---|---|
| `/sign-in` | Anyone; email code |
| `/dev/sign-in` | Only with `DRIPSIGN_DEV_LOGIN=1` on a loopback origin outside production |
| `/` | A signed-in recipient: agreements they are on |
| `/agreements/[id]` | A live recipient of that agreement |
| `/agreements/[id]/sign` | A required signer of the active round: review, then sign |
| `/staff` | Live staff: dashboard and agreement list; "New agreement" creates a draft and opens it |
| `/staff/agreements/[id]` | Staff of the agreement's tenant: workspace; a draft's rail is the assistant |
| `/staff/agreements/[id]/publish` | Staff of the tenant: review the draft PDF, then publish |
| `/staff/team` | Staff admins; anyone else gets not found |
| `GET /api/agreements/[id]/files/[kind]` | Staff or recipient of the agreement; kinds `draft`, `current`, `revision`, `signed`, `audit` |
| `POST /api/bridge/session` | A host with a valid signed assertion; off unless `DRIPSIGN_HOST` |
| `GET /api/health` | Anyone |

An unavailable agreement and a forbidden one render the same not-available page.

## Subdirectories

| Path | What |
|---|---|
| `src/app/` | Routes: pages and route handlers |
| `src/server/` | Session and capacity, the `action` wrapper, `actions/` server actions |
| `src/features/` | Feature components and logic per screen |
| `src/ui/` | Primitives and tokens; see its [README](src/ui/README.md) |

## Rules

- Server components by default; a client component only where state or events need it.
- Mutations are server actions in `src/server/actions`, wrapped by `action(schema, handler)`.
- Styles use tokens only (`--ds-*`); no raw colours or sizes.
- Read [AGENTS.md](AGENTS.md) and `node_modules/next/dist/docs/` before writing Next code.

[Architecture](../../docs/ARCHITECTURE.md) · [Core](../../packages/core/README.md)
