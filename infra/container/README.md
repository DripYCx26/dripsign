# Container

Build the shared image from the repository root using `infra/container/Dockerfile`. The build consumes the committed pnpm lockfile and explicit workspace directories. Root `.dockerignore` excludes local secrets and build output. The digest-pinned Node base supports the declared Node 24 runtime; updating the base is an explicit dependency change.

| File | Purpose |
| --- | --- |
| [Dockerfile](Dockerfile) | Build the web UI and retain TypeScript sources for the jobs runtime |

The default command starts `@dripsign/web` on port 3000. ECS overrides it to `pnpm --filter @dripsign/jobs start` for the jobs service. Both run as the unprivileged Node user. No credentials are accepted at image build time. Configuration is private runtime data and is never passed as a public Next.js variable.

The environment contract follows the actual application owners. Supply these keys before starting tasks:

| Runtime | Keys | Source |
| --- | --- | --- |
| Both | `DRIPSIGN_DATABASE_URL`, `AWS_REGION`, `DRIPSIGN_DOCUMENT_BUCKET` | Dedicated DB secret and stack resources |
| Both | `DRIPSIGN_PUBLIC_ORIGIN` | Exact HTTPS origin for the current environment |
| Web | `DRIPSIGN_AUTH_SECRET`, `DRIPSIGN_STAFF_MEMBERSHIPS`, `DRIPSIGN_BRIDGE_ISSUERS` | Web secret JSON |
| Jobs | `DRIPSIGN_EMAIL_FROM` | Exact SES sender |
| Jobs | `ANTHROPIC_API_KEY`, `DRIPSIGN_HOST_EVENT_URL`, `DRIPSIGN_HOST_EVENT_SECRET` | Jobs secret JSON |

`DRIPSIGN_STAFF_MEMBERSHIPS` is a JSON array of exact tenant/user/email mappings. `DRIPSIGN_BRIDGE_ISSUERS` is a JSON array of issuer/audience/secret records. These are private server configuration. Authentication and event secrets require at least 32 bytes. The host event URL is a private configured HTTPS destination; it is never taken from contract text. Optional admission and recovery controls are documented by their owners in [web setup](../../apps/web/README.md) and [jobs setup](../../apps/jobs/README.md).

Native signing records consent inside DripSign against the frozen published revision and required signer set. Jobs create the signed PDF and audit record and archive both through the existing private S3 storage. No external signing credentials or callback configuration are required. The generic stack retains AES256 bucket encryption; signature archival uses the application's immutable object and hash checks.

Jobs bounds and paid-call admission belong to the jobs/core configuration and database. Initial CPU/memory and task-count limits in the generic stack are assumptions for staging, not measured capacity. The native signer has not been deployed by this change. Keep web and jobs task counts at zero until private release checks establish readiness, email delivery, signing, archival, and recovery.
