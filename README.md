# DripSign

DripSign is an open source agreement workspace. Staff prepare a document,
recipients propose changes in a shared thread, and staff publish the agreed
version for signature. The signed PDF and audit record stay with the agreement.

The product has one signing authority. A host application may show the staff
interface through an authenticated bridge, while recipients use the standalone
portal. A shared interface does not grant access by itself: the server checks
the sender, recipient, agreement, and current revision for each operation.

## What it does

- Email codes give each recipient access to the agreements shared with that address.
- A document sits beside a turn-based proposal thread. Accepting a change creates
  a private draft; publishing creates a new immutable PDF version.
- Required signers verify their invited email, accept the signing terms, and
  sign the exact published PDF with their typed name. Completion requires every
  signature and archived evidence.
- A private staff workspace can ask Claude Sonnet 5.5 for suggested edits. A
  staff member must review and publish any resulting change.
- A host app can mount the shared staff UI through a signed server bridge, or
  frame the whole staff workspace after its own sign-in with a signed staff
  session bridge. DripSign remains the owner of agreement data and signing state.

## Sign in

One host serves recipients and staff. Recipients open the agreement link from
their invitation and enter the invited email; staff use **Staff sign-in** at the
top of the page with their work email. Both receive a one-time code, and
**Sign out** ends the session. Passkeys are not supported.

## Run your own instance

Use Node 24 and pnpm 10.34.6. Supply a PostgreSQL database, private document
storage (an S3 bucket or an Azure Blob container), a mail sender (SES or Azure
Communication Services), and the server-only configuration listed
in [web setup](apps/web/README.md), [jobs setup](apps/jobs/README.md), and the
[container guide](infra/container/README.md). Run the database migration with
the owner-capable identity, bootstrap staff membership, then start web and jobs.
The web app alone does not send codes or process signatures.

The [AWS template](infra/aws/README.md) provides separate web and jobs tasks,
restricted roles, private storage, and optional host routing. The
[Azure template](infra/azure/README.md) provides the same on Container Apps with
Blob, Key Vault, Communication Services, Front Door, and a private PostgreSQL
server. DNS, certificates, mail domain approval and production secrets are
supplied by the operator. `pnpm test` runs the adapter tests. The
[local stack](infra/container/README.md#local-stack) runs everything on one
machine with documents on disk and mail in a folder, and `pnpm smoke` drives the
whole journey against it or, with `DRIPSIGN_SMOKE_URL`, against a deployment
([smoke journey](apps/web/README.md#smoke-journey)). [Paired releases](infra/paired-release.md) describe how a host app can
pin a DripSign version without sharing its database or credentials.

The architecture and product decisions are recorded in
[docs/DECISIONS.md](docs/DECISIONS.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
