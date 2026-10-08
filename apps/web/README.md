# DripSign web

The standalone Next.js application serves recipient review at `/` and native
staff access at `/staff`. Both use email codes and HttpOnly sessions. The store
resolves current grants before every agreement operation.

| Path | Purpose |
| --- | --- |
| `src/app` | Pages, native signing API, and authenticated host bridge. |
| `src/components` | Login and transport bindings for the shared agreement interface. |
| `src/server/config.ts` | Validated private deployment configuration. |
| `src/server/commands.ts` | Strict command schema and store dispatch. |
| `src/server/bridge.ts` | Request-bound HMAC assertions and durable replay rejection. |
| `src/server/sessions.ts` | Opaque native session and challenge cookies. |
| `src/signingConsent.ts` | Public consent constants exported by the database contract. |

## Run

From the repository root, install dependencies, then run
`pnpm --filter @dripsign/db migrate` with `DRIPSIGN_MIGRATION_DATABASE_URL` and the migration database identity and
`pnpm --filter @dripsign/db bootstrap-staff` with the configured staff roster
before starting the application. Neither command sends an email. Web
startup never creates a staff membership. Configure the same staff emails in
`DRIPSIGN_STAFF_MEMBERSHIPS`; database membership and revocation remain
necessary for access.

```sh
pnpm --filter @dripsign/web dev
pnpm --filter @dripsign/web type-check
pnpm --filter @dripsign/web build
pnpm --filter @dripsign/web start
```

Document storage follows `DRIPSIGN_STORAGE_PROVIDER`: `s3` (default) reads
`AWS_REGION`, `DRIPSIGN_DOCUMENT_BUCKET`, and the optional `DRIPSIGN_KMS_KEY_ID`;
`azure` reads `DRIPSIGN_BLOB_ENDPOINT`, `DRIPSIGN_DOCUMENT_CONTAINER`, and
`AZURE_CLIENT_ID` with the identity endpoint Container Apps sets
(`IDENTITY_ENDPOINT`, `IDENTITY_HEADER`). The [jobs setup](../jobs/README.md)
lists the same keys. The storage is chosen on first use, so a missing key fails
the first document request rather than startup.

The server listens on port 3000. `/health` reports process health. It does not
prove database or provider readiness. The jobs application must run for queued
emails, signed-document archival, and AI suggestions. Signature acceptance is a
synchronous database transaction in the web service.

## API

Responses carry `X-DripSign-Api-Version: 2`. Native mutations require an exact
`Origin` equal to `DRIPSIGN_PUBLIC_ORIGIN`. Identity headers from a browser
are never used. Routes return private, uncached responses.

| Native route | Operation |
| --- | --- |
| `POST /api/auth/request` | Request an email code without revealing membership. |
| `POST /api/auth/verify` | Consume a code bound to an opaque challenge token and create a session cookie. |
| `POST /api/auth/logout` | Revoke the session. |
| `GET/POST /api/agreements` | List authorized agreements or create a private draft. |
| `GET /api/agreements/:id` | Read the current authorized projection. |
| `POST /api/agreements/:id/commands` | Versioned proposal, draft, publication, signing request, or private AI command. |
| `POST /api/agreements/:id/upload` | Prepare a bounded PDF as a private draft. |
| `GET /api/agreements/:id/pdf` | Stream an authorized issued, private, signed, or audit PDF. |
| `POST /api/agreements/:id/sign` | Record the recipient's typed-name signature and exact-version consent; return a durable receipt. |
| `GET /api/agreements/:id/signature-status` | Read confirmed local signing and archival evidence. |

Command shapes live in `src/server/commands.ts`; creation lives in
`src/server/api.ts`. Assets and identities are selected server-side. Uploaded
PDFs are checked only for byte length and their PDF envelope in web requests.
The jobs service parses and prepares a derived asset before staff review;
publication stays disabled while preparation is pending or failed. Original
and prepared PDFs stay immutable, and signature fields freeze on publication.

Signing requires the active round ID, revision ID, PDF SHA-256, trimmed typed
name, current consent version and hash, and explicit `consentAccepted: true`.
The recipient must have verified email within the database contract's signing
verification window. The store rechecks the session, exact recipient grant,
round, revision, consent, and expected agreement version in the transaction.
Names must pass the signed-PDF renderer's font check before acceptance. The
response contains signature identity, name, timestamp, revision, and document
hash; it contains no external signing URL or private session evidence.

The request evidence records a server-generated request ID and bounded user
agent. IP address remains unknown because no trusted proxy chain is configured.
Forwarded address headers never establish signer identity. A stale verification
offers the existing email-code flow at the same agreement URL. The final required
signature closes negotiation; signed status and downloads wait for both archived
files. Staff still explicitly review and publish each new revision.

The `adopt_ai_candidate` staff command stages one current, reviewed AI candidate
as private source. Staff save that working draft to prepare its PDF, then review
and explicitly publish it. Adoption never publishes or requests signatures.

## Host bridge

The `/api/bridge/agreements` list/create routes and agreement detail, command,
upload, and PDF routes accept server assertions only. They never accept native
cookies as bridge authority. A trusted host sends:

```text
Authorization: Bearer base64url(claims).base64url(HMAC-SHA256(encodedClaims))
```

The strict claims are `issuer`, `audience`, `subject`, `tenantId`, `resource`,
`operation`, `method`, `path`, `bodySha256`, `issuedAt`, `expiresAt`, and `nonce`.
The timestamps are Unix seconds; validity is at most 30 seconds. `path` includes
the exact query string. `bodySha256` hashes the raw request bytes, including an
empty body for GET. The database consumes each nonce once, including reads,
and rechecks native staff membership and agreement ownership.

List/create use resource `agreements` and operation `list`/`create`. Detail uses
resource agreement ID and operation `read`; PDF uses `download`; command uses
its exact action; upload uses `upload`. Bridge upload places `expectedVersion`
and `idempotencyKey` in the signed query string. Native upload uses
`X-Expected-Version` and `Idempotency-Key` headers. Every mutation has a durable
idempotency key separate from the one-use transport nonce.

Private configuration is validated in `src/server/config.ts`. Bridge secrets,
session secrets, provider credentials, and document keys never enter a client
bundle. Logs contain request IDs and error classes, not submitted text.

## Admission pause

`DRIPSIGN_ADMISSION_PAUSED=1` blocks new agreements, edits, publications,
uploads, signature access, signature requests, and AI requests at the server.
Reads, sign-out, and cancellation requests remain available. Email-code requests return `503 admission_paused` to avoid queuing late
codes during recovery. Existing authenticated sessions retain read access. Change the runtime configuration and restart the service;
the application validates it at startup. `DRIPSIGN_RECOVERY_ONLY=1` on the jobs service admits only signing
archival. Pending email codes retain their original expiry; the jobs service does not
deliver them in recovery mode.

Bridge creation persists server-derived `createProvenance` with tenant, staff
subject, idempotency key, and the exact raw request SHA-256. Native creation
stores none. Signed execution events carry that provenance for exact host
reservation recovery without copying recipient information.

`POST /api/bridge/agreements/recover` is a read-only metadata lookup using
operation `recover_create`, resource `agreements`, and strict body
`{subject,idempotencyKey,bodySha256}`. Its signed assertion hashes the lookup
body; `bodySha256` in that body names the original create request. It remains
available during admission pause and checks current staff membership.
