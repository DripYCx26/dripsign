# Decisions

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

Michael rejected DocuSeal as DripSign's signer. DripSign verifies the invited
email, records a typed-name signature and explicit consent against one frozen
PDF revision, then produces the signed PDF and audit record from those records.
The final required signature closes negotiation immediately. Artifact creation
may finish later; the agreement becomes signed only after both files are stored.

The shared chat sits left of the PDF on desktop. A recipient may propose a
change while signing is still open. That action closes the unfinished signing
round in the same transaction and keeps any earlier signatures as evidence of
the closed round. A completed round requires a separate amendment. AI may draft
a private candidate from a proposal. Staff must review the wording and PDF and
explicitly publish a new immutable revision before anyone signs it. Uploaded
PDFs require a staff-supplied replacement unless staff first adopts editable
source. The public dreach.ai website is outside this change; DripSign uses its
visual language without copying another product's name, assets, or copy.

The selected design uses database signature evidence and deterministic PDF
archival. Names must be renderable in the signed PDF before a signature is
accepted. The rejected alternative adds a KMS evidence seal and S3 Object Lock
at launch; those add key and retention operations without an established pilot
requirement. The signed PDF is an electronic-signature rendition, not a claim
of certificate-based PDF signing or independent timestamping.

This supersedes the DocuSeal submission, callback, signing URL, and provider
reconciliation portions of the decision below. Existing provider rounds, if
any, must be inventoried and preserved before release. Deployment, SES sending
readiness, legal template review, and a controlled signing run remain release
gates. After native signatures exist, rollback must retain native support.

## 2026-10-07: One signing service with a host application bridge (historical provider plan)

DripSign owns agreement documents, proposals, issued revisions, required
signers, provider submissions, and archived evidence. Its standalone portal is
available to invited recipients. A host application may mount the shared staff
interface and call a narrow DripSign API through a server-side identity bridge.
The bridge names the actor, tenant, resource, operation, request body, and
expiry; DripSign verifies each request and checks its own authorization rules.

For Dreach, the staff entry is `app.dreach.ai/sign` and the public site is
`dripsign.com`. The public domain's DNS is pending. Production credentials,
account identifiers, and deployment authority stay in private configuration.
A private release manifest pins the DripSign image, shared interface package,
API compatibility version, and Dreach image. The two runtimes must tolerate a
partial release and support rollback against the same DripSign database.

Accepting a change updates a private working draft. A separate staff publish
action creates an immutable revision. An agreement is complete only when every
required signer has signed that exact revision and the signed document and
audit evidence have been archived.

Only one proposal can await a response on a published revision. A counter
supersedes it and gives the other side the next decision. Either side may
accept wording proposed by the other side. Acceptance stages the change
privately; staff preview and publish it. Ordinary messages never change the
document. Stale proposals and versions are refused. An active signing round
must be confirmed cancelled before the document changes. A completed
agreement needs a separate amendment.

Recipients verify their exact granted email. Every read, proposal, signature
action, and download checks the current grant. Every DocuSeal signer also
verifies an email code before accessing the signing document. DripSign sends
the invitation; DocuSeal signature request emails remain disabled.
A host bridge assertion binds
the staff member, tenant, resource, operation, method, path, body hash,
audience, nonce, and short expiry. DripSign consumes the nonce atomically,
rechecks membership and scope, and uses a separate idempotency key for
mutations. The host browser never receives the bridge signing secret.

A published PDF includes its standard signature page and field positions, so
staff can preview the exact bytes before inviting signatures. The original
uploaded PDF is preserved separately. The published revision stores the field
positions and signer set; the signing request cannot substitute either.

A signing round freezes the revision hash and required signer identities. A
provider creation timeout remains uncertain until reconciled; the app never
blindly creates a second submission. Authenticated, deduplicated provider
events and bounded reconciliation update signer progress. The signed document
and audit record are archived before a generic executed event is queued for
idempotent delivery to the host application.

Uploaded PDFs remain immutable. A sender can replace one with a new reviewed
PDF. Automatic clause edits require a separately adopted editable source;
there is no claim that arbitrary PDFs can be rewritten faithfully.

This replaces the proposed contract backend in the unreleased Dreach portal
draft. Dreach retains its staff identity checks and a private deal mapping,
and consumes an idempotent executed event. The signing service does not read
Dreach's business tables.

The rejected alternative was to publish the existing private portal as the
DripSign product. That would leave DripSign dependent on Dreach's database,
authentication, and release cycle. A second signing backend was also rejected
because two writers could disagree about the operative revision or signature
state.

Residual risks are cross-service authorization, negotiation and signing races,
provider uncertainty, and partial deployments. They require explicit state
transitions and release checks before a live invitation is sent.
