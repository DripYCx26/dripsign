# DripSign jobs

This application executes the durable outbox owned by `@dripsign/db`. Provider
clients, document storage, and private suggestion generation come from
`@dripsign/core`.

The directory contains the following runtime modules.

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Loads configuration and drains the worker on SIGINT or SIGTERM. |
| `src/config.ts` | Validates private configuration and pilot admission bounds. |
| `src/runner.ts` | Claims available process capacity with durable leases. |
| `src/effects.ts` | Executes mail, signing, archival, private AI, PDF preparation, and event jobs. |
| `src/hostDelivery.ts` | Signs and sends the allowlisted executed event. |
| `src/metadataLog.ts` | Emits metadata without customer text or credentials. |

Run `pnpm --filter @dripsign/jobs start` with Node 24 and a migrated database.
The worker never applies migrations at startup. Typecheck with
`pnpm --filter @dripsign/jobs type-check`.

Runtime configuration uses the following environment variables.

| Variables | Requirement |
| --- | --- |
| `DRIPSIGN_DATABASE_URL`, `AWS_REGION` | Private database connection and AWS region. |
| `DRIPSIGN_DOCUMENT_BUCKET`, `DRIPSIGN_KMS_KEY_ID` | Private document bucket; KMS key is optional. |
| `DOCUSEAL_API_URL`, `DOCUSEAL_API_KEY` | Signing provider connection. |
| `DOCUSEAL_ARTIFACT_ORIGINS` | Comma-separated HTTPS origins for documents and signing links. |
| `DRIPSIGN_EMAIL_FROM`, `DRIPSIGN_PUBLIC_ORIGIN` | Authorized sender and recipient portal HTTPS origin. |
| `ANTHROPIC_API_KEY` | Private Sonnet 5.5 access. |
| `DRIPSIGN_HOST_EVENT_URL`, `DRIPSIGN_HOST_EVENT_SECRET` | Fixed HTTPS host endpoint and signing secret of at least 32 bytes. |
| `DRIPSIGN_JOBS_CONCURRENCY`, `DRIPSIGN_JOBS_POLL_MS` | Optional process concurrency and idle polling interval. |
| `DRIPSIGN_JOBS_GLOBAL_CONCURRENCY`, `DRIPSIGN_JOBS_TENANT_CONCURRENCY` | Optional lower durable concurrency limits. |
| `DRIPSIGN_JOBS_GLOBAL_PER_MINUTE`, `DRIPSIGN_JOBS_TENANT_PER_MINUTE` | Optional lower claim rate limits. |
| `DRIPSIGN_RECOVERY_ONLY` | Set to `1` to claim only `signing_reconcile` and `archive`. Default is normal operation. |

Pilot limits are assumptions ratified for initial operation: process concurrency
defaults to 2 and may reach 4; durable admission allows 4 globally and 2 per
tenant, with 60 global and 20 tenant claims per minute. Each agreement holds
one dispatch lease. AI reserves the core adapter's maximum call cost against
the hard $10 tenant ceiling per UTC day. These values are not measured capacity.

SES sends, signing creation, and paid suggestions persist a dispatch marker
before calling the provider. Unknown outcomes retain their uncertainty and
AI reservation. Signing recovery reads the original attempt identity.
Reconciliation, immutable archival, and idempotent host delivery have at most
five attempts with exponential backoff, then require staff attention. Published
PDF bytes and the required signer set remain frozen; every required signature
and both archived artifacts precede the executed event.

A definitive signing-provider creation refusal returns the uncreated round to
negotiation under its current lease. Network errors, timeouts, and unknown
responses remain held for read reconciliation.

PDF preparation runs in the separately memory-bounded jobs process, after the
web process stores a private original using envelope checks. Each raw asset
gets one preparation attempt. A processing failure or expired worker lease
marks it failed; staff replace the PDF to try again. No automatic parser retry
runs on the same raw asset.

Recovery mode is executable with `DRIPSIGN_RECOVERY_ONLY=1 pnpm --filter
@dripsign/jobs start`. It admits only signing status reconciliation and
archival. It excludes invitations, OTP, signing creation and cancellation,
AI, host delivery, and new PDF preparation. Status reconciliation may confirm
provider expiration or record all-party completion under the same frozen round.

Host delivery signs `timestamp + '.' + exact JSON body` with HMAC SHA-256 and
sends `X-DripSign-Timestamp`, `X-DripSign-Signature`, and `Idempotency-Key`.
The event contains only event, tenant, agreement, and revision identifiers plus
signed and audit hashes and nullable creation provenance. Provenance includes
the tenant, staff subject, idempotency key, and original request hash. The host
must verify the signature and timestamp and deduplicate the event before acting.
