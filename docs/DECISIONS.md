# Decisions

## 2026-10-07: One signing service with a host application bridge

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
action, and download checks the current grant. A host bridge assertion binds
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
