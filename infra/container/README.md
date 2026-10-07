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
| Web | `DRIPSIGN_PUBLIC_ORIGIN` | Exact HTTPS origin for the current environment |
| Web | `DRIPSIGN_AUTH_SECRET`, `DRIPSIGN_STAFF_MEMBERSHIPS`, `DRIPSIGN_BRIDGE_ISSUERS`, `DOCUSEAL_WEBHOOK_SECRET` | Web secret JSON |
| Jobs | `DRIPSIGN_EMAIL_FROM`, `DOCUSEAL_API_URL` | Exact SES sender and HTTPS provider endpoint |
| Jobs | `DOCUSEAL_API_KEY`, `DOCUSEAL_ARTIFACT_ORIGINS`, `ANTHROPIC_API_KEY`, `DRIPSIGN_HOST_EVENT_URL`, `DRIPSIGN_HOST_EVENT_SECRET` | Jobs secret JSON |

`DRIPSIGN_STAFF_MEMBERSHIPS` is a JSON array of exact tenant/user/email mappings. `DRIPSIGN_BRIDGE_ISSUERS` is a JSON array of issuer/audience/secret records. These are private server configuration. Authentication and event secrets require at least 32 bytes. `DOCUSEAL_API_URL` is the outbound API endpoint that receives the DocuSeal API key. `DOCUSEAL_ARTIFACT_ORIGINS` is a separate comma-separated allowlist of exact HTTPS origins approved for signing pages, signed PDF downloads, and audit downloads. The current provider adapter checks all three against that allowlist. With the default API origin `https://api.docuseal.com`, the derived signing origin is `https://docuseal.com`; include that signing origin explicitly when using it, alongside each approved artifact storage origin. For a self-hosted provider, approve its actual signing origin and document origins separately. An allowed API endpoint does not implicitly approve a signing or document origin. Avoid wildcards and review provider origins before adding them. The host event URL is a private configured HTTPS destination; it is never taken from contract text. Optional KMS overrides require matching exact IAM grants and are omitted from the generic stack.

Jobs bounds and paid-call admission belong to the jobs/core configuration and database. Initial CPU/memory and task-count limits in the generic stack are assumptions for staging, not measured capacity. Measure readiness, delivery, provider behavior, and recovery before private production release.
