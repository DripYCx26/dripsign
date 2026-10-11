# Architecture

This document owns the system shape: processes, data lifecycle, identity, command and job
mechanics, files, host integration and configuration. Product decisions and their reasons live in
[DECISIONS.md](DECISIONS.md); the rules for working in the repository live in
[AGENTS.md](../AGENTS.md). Where a mechanism's code is still being written, this describes the
locked design.

## 1. Processes and packages

| Part | Runs | Owns |
|---|---|---|
| Web (`apps/web`) | Next.js server | Pages, server actions, four route handlers; transport and presentation only |
| Worker (`packages/core/src/jobs/main.ts`) | Node process, same image | Outbox jobs, PDF parsing and rendering, mail, archival, sweep |
| PostgreSQL 17 | Database | All state; evidence triggers; the signing state machine |
| Storage | Local files or S3 | Content-addressed PDFs and artifacts |
| Mail | Mailpit (SMTP) or SES | Codes, invitations, notifications |

`packages/core` is Next-free and holds every decision; web imports it as `@dripsign/core/<path>`.
Web and worker never call each other: the web enqueues a row in the outbox and the worker claims
it. Uploaded PDFs are parsed only in the worker, never in a web request.

## 2. Data and lifecycle

The baseline [schema](../packages/core/schema/schema.sql) is edited in place; there are no
migrations. Every tenant table carries `tenant_id` with composite `(tenant_id, ...)` foreign keys.

| Agreement status | Entered by | Leaves by |
|---|---|---|
| `draft` | creation | first publish to `negotiating` |
| `negotiating` | publish | request signatures to `signing`; void |
| `signing` | request signatures | completion to `signed`; round voided back to `negotiating`; void |
| `signed` | the completion gate (artifacts committed) | none |
| `void` | staff void, any status except `signed` | none |

- **Revisions** are immutable and numbered. Accepting wording stages a private draft; only a
  reviewed publish (the client sends the draft PDF sha it reviewed) creates a revision. The first
  publish moves `draft` to `negotiating` and sends invitations.
- **Proposals** follow a turn rule: one pending proposal per agreement (`one_pending_proposal`),
  decided by the other side. A proposal is accepted, rejected or superseded. Messages are
  immutable and interleave with proposals in one thread.
- **Signing rounds** freeze a revision, its document hash and the required signers
  (`one_live_round` allows one active or finalizing round). A round is `active`, `finalizing`,
  `completed` or `void`. Only a required signer of the active round can cancel it by proposing a
  change; staff cancel explicitly; removing a required signer voids the round. Nothing voids or
  edits a `finalizing` round.
- **Finalizing** begins when the last signature commits, in the same transaction that enqueues
  `archive`. The completion gate on `agreement` refuses `signed` without both artifacts.
- **Evidence triggers** make `revision`, `signature`, `artifact`, `round_signer` and `message`
  immutable; `guard_signing_round` enforces the round state machine. Never weaken one for code.

## 3. Identity and capacity

Identity is a verified email. A visitor requests a 6-digit code; the challenge stores an HMAC of it
bound to a cookie, expires in 10 minutes and allows 5 attempts. Limits per IP and per email apply,
and a response never reveals whether the email is known: every request inserts a challenge, mail
goes out only for a live staff or recipient row. The `dripsign_session` cookie is HttpOnly,
SameSite=Lax, 12 hours (`__Host-` prefixed in production).

A session stores the email, verification time and an optional selected staff tenant. It never
stores a role. Capacity is resolved from the database on every request:

| Route family | Needs |
|---|---|
| `/staff/**`, staff actions | A live `staff` row for the selected tenant (selected automatically when the email is staff in one tenant) |
| `/`, `/agreements/**`, recipient actions | A live `recipient` row for that agreement and email |

Unavailable and forbidden both answer as not found. Signing needs a fresh verification: a session
verified more than 30 minutes ago gets `verification_required`, answered by an inline code step,
never a sign-out. The dev sign-in runs the real code issue and consume with a fixed code; it is
enabled only when `DRIPSIGN_DEV_LOGIN=1`, `NODE_ENV` is not production and the origin is
loopback. `loadConfig()` refuses to start otherwise, and the dev action rechecks the Host header.

## 4. Commands and idempotency

`domain/policy.ts` holds `allowedActions(snapshot, capacity)`, the only home of lifecycle and
permission rules. Views return its result; every command recomputes it inside its transaction
after locking.

- **Receipts.** One `command_receipt` table keyed `(tenant_id, actor_email, key)` stores operation,
  capacity, resource, a hash of the canonical payload and the result. The same key and payload
  replays the stored result after rechecking authority; the same key with a different payload is a
  `conflict`. Every mutation carries a client key, reused on retry. No other idempotency mechanism
  exists.
- **Version fence.** Document-shaping commands update `agreement.version` where it equals the
  expected value; zero rows is a `conflict`. Lock order is receipt, agreement row, job rows.
- **Read snapshots.** Reads use a `REPEATABLE READ READ ONLY` transaction and take no row locks.
  Writes use `READ COMMITTED` with statement, lock and idle timeouts.
- **Errors.** `DomainError` codes: `not_found`, `conflict`, `invalid`, `rate_limited`,
  `verification_required`, `unavailable`. The server action wrapper maps them once.
- **Validation.** `packages/core/src/schema.ts` holds every schema and limit.

## 5. Jobs

The `outbox` table is the queue. A worker claims rows under a lease token; every later state
change is fenced by that token, so a stale holder cannot finish a job. `NOTIFY` wakes the worker.

| Kind | Does | Attempts |
|---|---|---|
| `email` | Sends a message; parameters are scrubbed when done | 5 |
| `pdf_prepare` | Parses an uploaded PDF in the worker, prepares signer fields | 2 |
| `ai_suggest` | Optional staff-private suggestion | 1 (a second claim fails and keeps its spend) |
| `archive` | Writes the signed PDF and audit record | never terminal |
| `host_event` | Posts the executed event to the host | 20 |

Retry backoff is `min(10s * 2^(attempts-1), 1h)` plus up to one second of jitter. Archive retries
forever with capped backoff; the first committed artifact pair wins and an already completed round
is done. The UI says the signed files are delayed after three attempts. The sweep
(`jobs/sweep.ts`) re-enqueues `archive` for any finalizing round without a live job, and deletes
expired challenges, sessions, rate-limit rows, nonces and old finished jobs.

## 6. Files and PDF

Storage is content-addressed: a file's key derives from its sha256, so identical bytes are one
object. File responses are `application/pdf` with `nosniff` and `Content-Security-Policy:
sandbox`.

Uploads (10 MB, 200 pages) are stored, then a `pdf_prepare` job parses them; the commit is fenced
on the upload sha and the signer-set hash of the current draft. Text agreements render in the
worker with one embedded font ([`assets/`](../packages/core/assets)), the same file the signature
preview uses. The signed PDF is an electronic-signature rendition with a signature page, not
certificate-based signing. The audit record is a second artifact built from the signature,
verification and consent rows. Uploaded PDFs are never rewritten.

## 7. Host integration

Off unless `DRIPSIGN_HOST` is set. Two Ed25519 contracts, with separate keys:

- **Entry.** `POST /api/bridge/session` takes a compact signed token in the `assertion` form field
  (`typ=dripsign-staff+jwt`, 60 seconds, nonce accepted once). The firm maps to a tenant in
  configuration and must be a live staff member. On success it sets an embed cookie and redirects
  to `/staff`.
- **Executed event.** A completed agreement is designed to enqueue `host_event`, signed with
  `DRIPSIGN_HOST_EVENT_SEED` in the host's frame.

`proxy.ts` sets a nonce-based CSP; `/staff/**` and the entry route allow the host origin as a
frame ancestor when configured, everything else forbids framing.

## 8. Configuration

`packages/core/src/config.ts` parses the environment once and is shared by web, worker and CLI.
[`.env.example`](../.env.example) lists every key with its local default; this document does not
repeat them. Production requires an https origin, S3 storage and SES email;
[infra](../infra/README.md) lists what an operator supplies.
