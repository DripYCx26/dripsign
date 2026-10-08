# Container

Build the shared image from the repository root using `infra/container/Dockerfile`. The build consumes the committed pnpm lockfile and explicit workspace directories. Root `.dockerignore` excludes local secrets and build output. The digest-pinned Node base supports the declared Node 24 runtime; updating the base is an explicit dependency change.

| File | Purpose |
| --- | --- |
| [Dockerfile](Dockerfile) | Build the web UI and retain TypeScript sources for the jobs runtime |
| [compose.yaml](compose.yaml) | The local stack: PostgreSQL, release steps, web, jobs, and a TLS edge |

The default command starts `@dripsign/web` on port 3000. ECS and Container Apps override it to `pnpm --filter @dripsign/jobs start` for the jobs service. Both run as the unprivileged Node user. No credentials are accepted at image build time. Configuration is private runtime data and is never passed as a public Next.js variable.

The environment contract follows the actual application owners. Supply these keys before starting tasks:

| Runtime | Keys | Source |
| --- | --- | --- |
| Both | `DRIPSIGN_DATABASE_URL` | Dedicated DB secret |
| Both | `DRIPSIGN_PUBLIC_ORIGIN` | Exact HTTPS origin for the current environment |
| Both, AWS | `AWS_REGION`, `DRIPSIGN_DOCUMENT_BUCKET` | Stack resources; `DRIPSIGN_STORAGE_PROVIDER` defaults to `s3` |
| Both, Azure | `DRIPSIGN_STORAGE_PROVIDER=azure`, `DRIPSIGN_BLOB_ENDPOINT`, `DRIPSIGN_DOCUMENT_CONTAINER`, `AZURE_CLIENT_ID` | Template resources and the app's identity |
| Web | `DRIPSIGN_AUTH_SECRET`, `DRIPSIGN_STAFF_MEMBERSHIPS`, `DRIPSIGN_BRIDGE_ISSUERS` | Web secret JSON on AWS; Key Vault references on Azure |
| Web, optional | `DRIPSIGN_BRIDGE_HOST_ORIGIN`, `DRIPSIGN_BRIDGE_PUBLIC_KEY` | Public settings for the [staff session bridge](../../apps/web/README.md#staff-session-bridge); both or neither |
| Jobs | `DRIPSIGN_EMAIL_FROM` | Exact SES sender, or the Communication Services sender |
| Jobs, Azure | `DRIPSIGN_MAIL_PROVIDER=azure`, `DRIPSIGN_EMAIL_ENDPOINT` | Communication Services endpoint; `DRIPSIGN_MAIL_PROVIDER` defaults to `ses` |
| Jobs | `ANTHROPIC_API_KEY`, `DRIPSIGN_HOST_EVENT_URL`, `DRIPSIGN_HOST_EVENT_SECRET` | Jobs secret JSON on AWS; Key Vault references on Azure |

`DRIPSIGN_STAFF_MEMBERSHIPS` is a JSON array of exact tenant/user/email mappings. `DRIPSIGN_BRIDGE_ISSUERS` is a JSON array of issuer/audience/secret records. These are private server configuration. Authentication and event secrets require at least 32 bytes. The host event URL is a private configured HTTPS destination; it is never taken from contract text. Optional admission and recovery controls are documented by their owners in [web setup](../../apps/web/README.md) and [jobs setup](../../apps/jobs/README.md).

Native signing records consent inside DripSign against the frozen published revision and required signer set. Jobs create the signed PDF and audit record and archive both through the configured private storage, S3 or Blob. No external signing credentials or callback configuration are required. The generic stack retains AES256 bucket encryption; signature archival uses the application's immutable object and hash checks.

Jobs bounds and paid-call admission belong to the jobs/core configuration and database. Initial CPU/memory and task-count limits in the generic stack are assumptions for staging, not measured capacity. The native signer has not been deployed by this change. Keep web and jobs task counts at zero until private release checks establish readiness, email delivery, signing, archival, and recovery.

## Local stack

`compose.yaml` runs the image the way a deployment does, on one machine:

```sh
docker compose -f infra/container/compose.yaml up --build --detach
```

It builds the image once, creates the roles from [database.sql](../database.sql), applies the
migrations with the migrator login, records one staff membership (`staff@example.com`), revokes
the runtime's migration ledger, then starts web and jobs behind Caddy at `https://localhost:8443`.
Caddy's local authority signs the certificate, so the HTTPS origin, secure cookies, and redirects
behave as deployed; its root certificate lands in `infra/container/.local/caddy`. Documents use the
`filesystem` provider on a volume, and mail uses the `directory` provider: each message is a file in
`infra/container/.local/mail`, and nothing is sent. Only the edge reaches the host network; the
other services have no route off the machine, so AI suggestions fail and the executed event retries
until it needs staff attention. Every password and secret in the file is a local placeholder.

Sign in at `https://localhost:8443/staff` with `staff@example.com` (trust the root certificate, or
accept the browser warning) and read the code from the newest file in `.local/mail`. The
[smoke journey](../../apps/web/README.md#smoke-journey) runs against this stack with `pnpm smoke`.
Stop with `docker compose -f infra/container/compose.yaml down --volumes`, which discards the
database and documents; delete `.local` to reset mail and the certificate authority.
