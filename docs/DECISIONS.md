# Decisions

Dated product and architecture decisions. A newer entry supersedes an older one where they
conflict; superseded text is deleted rather than kept as history (Git holds it).

## 2026-10-11: V1 architecture after the simplification review

**Context.** A harsh three-lane review of the first build (data and jobs, web and auth, UI and
docs) found one blocker and a pattern. The blocker: an archive job could end failed with no
requeue, leaving a fully signed agreement in `signing` forever. The pattern: rules in several
homes (validation limits in three places, staff identity in an env var and a table, duplicated
bridge routes), a five-level store inheritance chain, reads taking row locks, and no way to run
the product without AWS.

**Council.** Two blind designs (Opus, Sonnet), judged by a fresh Sol instance. Selected: keep a
Next-free `packages/core` beside `apps/web`, keep tenancy, implement the Dreach host contracts.
Grafted from the other design: one command-receipt table as the only idempotency mechanism.

**Decided.**
- Two packages. `packages/core` holds schema, domain, PDF, adapters, worker and CLI;
  `apps/web` holds pages, server actions and components. `packages/db`, `packages/ui` and
  `apps/jobs` are gone.
- One baseline schema edited in place until the first production deploy; no migration chain.
- Identity is a verified email. Staff and recipient capacity are resolved per route on every
  request, so one person can be both. Staff membership lives only in the `staff` table.
- One policy function decides allowed actions for views and commands alike.
- Reads take no row locks; document-shaping commands fence on the agreement version.
- The last signature enqueues archival in the same transaction, and archival never becomes
  terminal. A sweep re-enqueues any finalizing round that has no live job.
- Only a required signer of the live round can close it by proposing a change.
- Uploaded PDFs are parsed only in the worker.
- AI suggestions are optional, staff-private, budgeted, and never triggered by recipients.
- Local development needs Docker only: Postgres, Mailpit, file storage, and a dev sign-in that
  runs the real code path and cannot start in production.
- The Dreach integration uses Dreach's published contracts: an Ed25519 staff assertion posted to
  `/api/bridge/session` and an Ed25519-signed executed event. The earlier HMAC request bridge is
  removed. Both are off unless `DRIPSIGN_HOST` is set.

**Rejected.** One package without tenancy (cheaper now, costly to reverse, and drops isolation
the old schema already enforced). Cutting host integration (Dreach PD-25 keeps the bridge and
webhook, and Dreach's half already exists). Jobs inside the web process (couples leases to hot
reload and puts untrusted PDF parsing in web requests).

**Residual risk.** Dreach DRE-201 is still marked proposed; if its contract changes, the host
module changes with it. At-least-once email may duplicate a message after a crash. A permanent
storage fault needs an operator; archival retries but cannot repair configuration.

## 2026-10-11: V1 interface

**Council.** Two blind designs (Opus, Sonnet), judged by a fresh Fable instance. Selected the
design grounded in verified client defects (composer state lost on refresh, a new idempotency key
on every retry, re-verification that signed people out). Grafted: workspace tab and revision in
the URL.

**Decided.** One app with role-prefixed routes; a status-driven primary action from one pure
function; a reading view plus the exact PDF rendered with pdf.js and signature field markers; a
focused review-and-sign flow with a live signature preview in the font the signed PDF embeds;
re-verification as an inline code step; the visual language shared with Dreach under DripSign's
own name.

## 2026-10-07: DripSign signs agreements itself

DripSign verifies the invited email, records a typed-name signature and explicit consent against
one frozen PDF revision, then produces the signed PDF and audit record from those records. The
signed PDF is an electronic-signature rendition, not certificate-based PDF signing or independent
timestamping. A KMS evidence seal and S3 Object Lock were rejected for launch: they add key and
retention operations without an established pilot requirement.

A recipient may propose a change while signing is open; that closes the unfinished round and keeps
earlier signatures as evidence. A completed agreement needs a separate amendment. AI may draft a
private candidate; staff review it and publish a new immutable revision before anyone signs.
Uploaded PDFs are never rewritten; staff upload a replacement.

Release gates outside this repository: deployment, SES production sending, legal review of the
consent text and templates, and a controlled signing run.
