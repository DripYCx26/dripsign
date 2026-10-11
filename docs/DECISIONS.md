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
- Deployment ships as one container image run twice (web and worker). AWS and Azure stay
  supported through adapters chosen by configuration and two templates (2026-10-08 entry
  below); the templates take the rebuilt settings. The paired-release schema is removed.
- The 2026-10-08 work merged on `origin/main` (Azure adapters and template, framed staff
  bridge, completion export) is ported onto the rebuilt packages rather than kept on the old
  ones. Local development uses Mailpit instead of the mail folder spool.

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

## 2026-10-08: A host app frames the staff workspace through a signed staff session bridge

A host app that signs its own staff in can show DripSign's whole staff
workspace inside its page. The host's server signs one assertion per opening
with an Ed25519 key, and its page posts it as a form into a frame on DripSign's
own origin. DripSign verifies it with the host's public key alone, records its
nonce once, requires its own current staff membership for that email and tenant,
and opens an ordinary staff session in a cookie partitioned to the host page.
DripSign keeps its database, sessions and authorization; the two products share
one public key and two origins, never a secret or a cookie. Staff pages and the
bridge entry allow the configured host, and only it, as their frame parent; the
policy is set per request because the image is built without configuration.

Rejected alternatives: proxying the staff pages through the host's origin,
which would run DripSign's scripts with the host session's authority and
require rewriting DripSign's paths and exact-origin checks; rendering the
shared UI package inside the host over the server bridge, which makes every
host own a second staff interface and a matched release; and a shared HMAC
secret, which lets either side mint the other's assertions. The request-bound
server bridge stays for hosts that call the API from their own servers.

Residual risks are browsers that keep no partitioned cookie inside a frame
(Safari before 26.2), which need the host's new-tab path, and an assertion
leaked within its lifetime, which opens one session for a listed member only.

## 2026-10-08: One host for recipients and staff; a local stack on disk and a mail folder

The standalone portal serves recipients at `/` and staff at `/staff` on one
host, the Front Door endpoint until the operator names a domain. Each signed-out
page links to the other sign-in at the top; staff use the same email codes as
recipients, gated by staff membership. The shared pages carry no authority: the
store checks membership or the exact grant on every operation.

`@dripsign/core` gains a `filesystem` document store and a `directory` mail
spool behind the existing ports, chosen in the same factory. They let
`infra/container/compose.yaml` run web, jobs, and PostgreSQL on one machine with
no cloud account, and a smoke journey drive the whole negotiation and signing
flow over HTTP against it or a deployment. The store creates each object once
through an exclusive hard link and verifies length and SHA-256 on every read;
the spool writes each message whole and sends nothing.

Rejected alternatives: S3 and Blob emulators, which add images whose
compatibility with conditional writes and encryption headers would need its own
proof; reading codes from the database in the smoke, which couples the test to
the schema and to a private network; and Playwright, a new dependency the
repository does not need yet. The smoke therefore takes no screenshots.

## 2026-10-08: Hosting: AWS or Azure through two adapters and two templates; chosen by configuration

DripSign runs on AWS or on Azure. `@dripsign/core` holds one document storage
port and one mail port. S3 and SES remain the default adapters, unchanged in
behaviour; Azure Blob and Azure Communication Services Email are the second
pair. `DRIPSIGN_STORAGE_PROVIDER` and `DRIPSIGN_MAIL_PROVIDER` choose them at
startup in one factory; web and jobs hold only the ports. Both now read the
optional KMS key from `DRIPSIGN_KMS_KEY_ID`; the web app's undocumented
`DRIPSIGN_DOCUMENT_KMS_KEY_ID` is gone. `infra/aws` and
`infra/azure` deploy the same shape: separate web and jobs runtimes with their
own identities, private storage that never overwrites or deletes a document, a
secret store, mail, a dedicated database with its own logins, and an HTTPS edge.

The Azure adapters call the REST APIs with Node's `fetch` and a token from the
Container Apps managed identity endpoint. They use no shared key, SAS, or
connection string, and add no dependency. The Blob adapter writes block blobs
once with `If-None-Match: *` and pins `x-ms-version`; an existing object counts
only after a verified read of the same bytes. The mail adapter sends each
message with its own `Operation-Id`, never resends an accepted send, and treats
a 5xx or a lost connection as uncertain, as the SES adapter does. The Azure
template writes secrets through the Key Vault control plane from ephemeral
values, so no secret enters Terraform state.

Rejected alternatives: the Azure SDK packages, which add dependencies for four
requests; provider checks at each call site, which would spread a second
storage path through the applications; and one cloud only, which would bind
every operator to one provider. Residual risks are the untested first
deployment of the Azure template, Contributor as the narrowest documented
mail-sending role, and an ingress host that answers outside Front Door. The
[Azure template](../infra/azure/README.md) records each.

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
