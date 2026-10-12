# Decisions

Dated product and architecture decisions. A newer entry supersedes an older one where they
conflict; superseded text is deleted rather than kept as history (Git holds it).

## 2026-10-11: Web and PDF share the signature face

A typed signature is drawn in Newsreader Italic on the web (the sign preview and the reading
sheet) and in the signed PDF, which embeds that face for the signature box alone and only when a
signature uses it. When Newsreader lacks a glyph of the name, every surface falls back to the
plain face (Noto Sans in the PDF); the server's name check returns the face, so the preview, the
sheet and the PDF agree. The PDF body stays Noto Sans: its glyph coverage decides which terms are
renderable, an evidence property, so web and PDF match in structure and signature, not in body
face. Under the signature the PDF prints the signing time and "Email verified", never an address.

Rejected: a handwriting face (a novelty beside a serif contract, Latin only); Newsreader for the
PDF body (it would refuse terms that render today).

## 2026-10-11: V1 removes uploaded PDFs and completion export

V1 removes uploaded PDFs and completion export; staff write terms in the app; host completion
delivery returns when a host needs it. Gone with them: the upload route, the isolated parser and
its inflation preflight, the active-content checks, the executed event, its pins, tables, job and
keys, and the staff settings page. The host bridge sign-in stays. Every revision now holds written
terms, which the database requires.

Rejected: keeping either behind a flag (dead code and configuration before any customer).

## 2026-10-11: Review round two and design pass

**Context.** A second adversarial review of the rebuilt product found evidence, session, upload
and roster gaps; a design pass then reworked the workspace.

**Decided: behaviour.**
- Lock order is receipt, agreement row, the actor's grant row `FOR SHARE`, then job rows, so a
  revocation committed while a command queued is seen and a later one waits.
- Signature and finalizing times are `clock_timestamp()`; the database refuses a verification
  after its signature (`verified_before_signed`) and a signature outside the round's window.
- One signer order, recipients by `(added_at, id)`, for staging, publication, the signature page
  and the audit record.
- The last live admin cannot step down or be removed, in the domain and in `cli add-staff`.
- Native and embed sessions are mutually exclusive wherever the browser sends both; an embed
  cookie that is present but invalid fails closed. Cross-site hosts get browser-partitioned
  contexts that never share a request. Bridge assertions live at most 60 seconds.
- A signature records the request's IP (trusted proxy hops only) and a bounded user agent.
- PDFs shared with recipients show signer names only; the audit record masks emails.
- The chat shows milestones only. Storage and mail are chosen by `DRIPSIGN_STORAGE` and
  `DRIPSIGN_EMAIL_TRANSPORT`.

**Decided: design.** A full-height workspace of two regions: the thread rail
`clamp(440px, 36vw, 640px)` (320 px when only history remains; hidden on a closed draft) beside the document. A chat-style composer starts proposals. Status
tabs are gone from the lists. Completion is a single-line strip. On a phone the open tab derives
from state: the document when the chat has nothing to offer, else chat.

**Rejected.** Keeping Activity as a tab (it duplicated the audit record; milestones in the thread
cover what a participant needs).

## 2026-10-11: V1 architecture after the simplification review

**Context.** A review of the first build found one blocker (an archive job could end failed,
leaving a signed agreement in `signing` forever) and a pattern of rules in several homes, a deep
store inheritance chain, reads taking row locks, and no way to run without AWS.

**Decided.**
- Two packages. `packages/core` holds schema, domain, PDF, adapters, worker and CLI;
  `apps/web` holds pages, server actions and components.
- One baseline schema edited in place until the first production deploy; no migration chain.
- Identity is a verified email. Staff and recipient capacity are resolved per route on every
  request, so one person can be both. Staff membership lives only in the `staff` table.
- One policy function decides allowed actions for views and commands alike; one command-receipt
  table is the only idempotency mechanism.
- Reads take no row locks; document-shaping commands fence on the agreement version.
- The last signature enqueues archival in the same transaction, and archival never becomes
  terminal. A sweep re-enqueues any finalizing round that has no live job.
- Only a required signer of the live round can close it by proposing a change.
- AI suggestions are optional, staff-private, budgeted, and never triggered by recipients.
- Local development needs Docker only: Postgres, Mailpit, file storage, and a dev sign-in that
  runs the real code path and cannot start in production.
- One container image runs web and worker.

**Rejected.** One package without tenancy; cutting host integration; jobs inside the web process
(couples leases to hot reload and puts PDF rendering in web requests).

**Residual risk.** Dreach DRE-201 is still marked proposed; if its contract changes, the host
module changes with it. At-least-once email may duplicate a message after a crash. A permanent
storage fault needs an operator.

## 2026-10-11: V1 interface

One app with role-prefixed routes; a status-driven primary action from one pure function; a
reading view plus the exact PDF rendered with pdf.js and signature field markers; a focused
review-and-sign flow with a live signature preview in the font the signed PDF embeds;
re-verification as an inline code step; workspace tab and revision in the URL; the visual
language shared with Dreach under DripSign's own name.

## 2026-10-08: A host app frames the staff workspace through a signed staff session bridge

A host app that signs its own staff in can show DripSign's staff workspace inside its page. The
host's server signs one Ed25519 assertion per opening and its page posts it as a form into a frame
on DripSign's origin. DripSign verifies it with the host's public key alone, records its nonce
once, requires its own current staff membership for that email and tenant, and opens a staff
session in a cookie partitioned to the host page. The two products share one public key and two
origins, never a secret or a cookie. Staff pages and the bridge entry allow the configured host,
and only it, as frame parent; the policy is set per request because the image is built without
configuration.

Rejected: proxying staff pages through the host's origin (DripSign's scripts would run with the
host session's authority); rendering a shared UI package inside the host (a second staff
interface and a matched release); a shared HMAC secret (either side could mint the other's
assertions).

Residual risks: browsers that keep no partitioned cookie inside a frame (Safari before 26.2) need
the host's new-tab path; an assertion leaked within its lifetime opens one session for a listed
member only.

## 2026-10-08: Hosting on AWS or Azure through two adapters and two templates

`packages/core` holds one storage port and one mail port. S3 and SES, and Azure Blob and Azure
Communication Services Email, are the two pairs; `DRIPSIGN_STORAGE` and
`DRIPSIGN_EMAIL_TRANSPORT` choose them at startup in one factory, and the local file store and
SMTP (Mailpit) are the same ports. `infra/aws` and `infra/azure` deploy the same shape: separate
web and worker runtimes with their own identities, private storage that never overwrites or
deletes a document, a secret store, mail, a dedicated database, and an HTTPS edge.

The Azure adapters call the REST APIs with Node's `fetch` and the managed identity endpoint; no
shared key, SAS or connection string, no added dependency. The Blob adapter writes once with
`If-None-Match: *`, and an existing object counts only after a verified read of the same bytes.
The mail adapter sends each message under its own `Operation-Id` and never resends an accepted
send. The Azure template writes secrets through the Key Vault control plane, so none enters
Terraform state.

Rejected: the Azure SDK packages (dependencies for four requests); provider checks at call sites
(a second storage path); one cloud only. Residual risks are the untested first deployment of the
Azure template and Contributor as the narrowest documented mail-sending role; see the
[Azure template](../infra/azure/README.md).

## 2026-10-07: DripSign signs agreements itself

DripSign verifies the invited email, records a typed-name signature and explicit consent against
one frozen PDF revision, then produces the signed PDF and audit record from those records. The
signed PDF is an electronic-signature rendition, not certificate-based PDF signing or independent
timestamping. A KMS evidence seal and S3 Object Lock were rejected for launch: they add key and
retention operations without an established pilot requirement.

A recipient may propose a change while signing is open; that closes the unfinished round and keeps
earlier signatures as evidence. A completed agreement needs a separate amendment. AI may draft a
private candidate; staff review it and publish a new immutable revision before anyone signs.

Release gates outside this repository: deployment, SES production sending, legal review of the
consent text and templates, and a controlled signing run.
