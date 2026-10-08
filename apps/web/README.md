# DripSign web

The standalone Next.js application serves recipients and staff from one host:
recipient review at `/` and the staff workspace at `/staff`. Both use email codes
and HttpOnly sessions. The store resolves current grants before every agreement
operation.

## Sign-in

The top of every signed-out page offers the other entry: recipients see
**Staff sign-in**, staff see **Recipient access**. Staff enter their work email
at `/staff`; a code goes only to an email in a current staff membership, and
the session opens the staff workspace. A staff session that lands on `/` or on
a recipient agreement link is sent to the matching staff page. Recipients keep
the code-per-agreement path: the invitation link `/agreements/:id` asks for the
invited email, and a code goes only to an email with a live grant. **Sign out**
in the header revokes the session in the database before clearing the cookie.
One browser holds one session, so signing in as the other kind replaces it.
A host app can also open a staff session inside its own page; see
[Staff session bridge](#staff-session-bridge).
Passkeys do not exist in this repository; sign-in is email codes only.

The interface grants nothing on its own. Every read, command, upload, download,
and signature resolves the session, then the store checks the staff membership
or the exact recipient grant for that agreement. Mutations also check the
expected agreement version, and a signature the active round and its frozen
revision, in the same transaction.

The public host is `DRIPSIGN_PUBLIC_ORIGIN`. The [Azure template](../../infra/azure/README.md)
sets it to the Front Door endpoint until `host` names a domain, then to that
domain once its CNAME and `_dnsauth` records exist.

| Path | Purpose |
| --- | --- |
| `src/app` | Pages, native signing API, and authenticated host bridge. |
| `src/components` | Login and transport bindings for the shared agreement interface. |
| `src/server/config.ts` | Validated private deployment configuration. |
| `src/server/commands.ts` | Strict command schema and store dispatch. |
| `src/server/bridge.ts` | Request-bound HMAC assertions and durable replay rejection. |
| `src/server/staffAssertion.ts` | The staff session bridge's Ed25519 assertion verifier; pure, with its own tests. |
| `src/app/api/bridge/session` | Opens a framed staff session from one verified assertion. |
| `src/proxy.ts` | Staff pages and the bridge entry take their frame parent from configuration. |
| `src/framing.ts` | The one Content-Security-Policy, with its frame parent as the only variable. |
| `src/components/StaffSignIn.tsx` | Staff sign-in, or inside a host page, a note to reopen it there. |
| `smoke/bridge.test.ts` | The staff session bridge over HTTP, with the test as the host app. |
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
(`IDENTITY_ENDPOINT`, `IDENTITY_HEADER`); `filesystem` reads the absolute
`DRIPSIGN_DOCUMENT_DIRECTORY` shared with jobs, for one host or the local stack. The [jobs setup](../jobs/README.md)
lists the same keys. The storage is chosen on first use, so a missing key fails
the first document request rather than startup.

The server listens on port 3000. `/health` reports process health. It does not
prove database or provider readiness. The jobs application must run for queued
emails, signed-document archival, and AI suggestions. Signature acceptance is a
synchronous database transaction in the web service.

## Smoke journey

`smoke/journey.test.ts` is a `node:test` run over `fetch`, with one cookie jar
per browser and the exact `Origin` a browser sends. The repository has no
browser harness, so it drives the same HTTP routes the pages call and checks the
sign-in link in the served HTML; it takes no screenshots. It covers staff
sign-in at the top of the page, preparing and publishing a document (which
invites the recipient), the recipient's proposal, staff acceptance and a second
publication, the signing request, the recipient's signature, both downloads of
the signed PDF and the audit record, refusals for a signed-out request, a
recipient reading the private draft or another agreement, and sign-out.

Against the [local stack](../../infra/container/README.md):

```sh
docker compose -f infra/container/compose.yaml up --build --detach
pnpm smoke
docker compose -f infra/container/compose.yaml down --volumes
```

Against a deployment, name its origin. Staff and recipient emails must reach
someone who can read the codes: the run asks for each one on stdin unless
`DRIPSIGN_SMOKE_MAIL_DIRECTORY` names a spool.

```sh
DRIPSIGN_SMOKE_URL=https://<host> DRIPSIGN_SMOKE_STAFF_EMAIL=<staff email>   DRIPSIGN_SMOKE_RECIPIENT_EMAIL=<inbox you read> pnpm smoke
```

`DRIPSIGN_SMOKE_CA_FILE` adds a PEM certificate authority; locally it defaults
to the edge's own. Each run creates one agreement and two sign-in codes; the
service allows five codes per email in fifteen minutes.

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

## Staff session bridge

A host app with its own sign-in can show the whole staff workspace in a frame
on its page. The host signs one short-lived assertion for the signed-in person,
and its page posts it as a form, field `assertion`, to
`POST /api/bridge/session` with the host's own `Origin`. DripSign checks it with
the host's public key, records its nonce once, and opens a staff session only
for an email with a current staff membership in the tenant the assertion names.
The session lives in `dripsign_bridge_session`, a `Secure; HttpOnly;
SameSite=None; Partitioned` cookie that the browser keeps only inside that host
page, for at most 12 hours; every request still rechecks the membership. A
refused assertion opens nothing and shows one fixed page. Inside the frame the
header offers neither sign-in nor sign-out; the host owns both. A browser that
keeps no partitioned cookie in a frame needs the host to post a fresh assertion
to a new tab instead.

| Setting | Value |
| --- | --- |
| `DRIPSIGN_BRIDGE_HOST_ORIGIN` | The host app's exact HTTPS origin: the only issuer, form origin and frame parent DripSign accepts. |
| `DRIPSIGN_BRIDGE_PUBLIC_KEY` | The host's Ed25519 public key, 64 lowercase hex; two keys separated by a comma while the host rotates. |

Both are set together or not at all. With them, staff pages and the bridge
entry allow the host origin, and nothing else, as `frame-ancestors`, and the
inline PDF allows its own pages and the host; every other page keeps
`frame-ancestors 'none'` and `X-Frame-Options: DENY`.

The assertion is a JWS compact token (RFC 7515) signed with Ed25519 (RFC 8037):
`base64url(header).base64url(claims).base64url(signature)` without padding, the
signature over the ASCII of the first two parts.

| Part | Content |
| --- | --- |
| header | Exactly `{"alg":"EdDSA","kid":K,"typ":"dripsign-staff+jwt"}`; `K` is the first 16 lowercase hex digits of the SHA-256 of the 32-byte public key. |
| `iss` | The host origin, `DRIPSIGN_BRIDGE_HOST_ORIGIN`. |
| `aud` | DripSign's own origin, `DRIPSIGN_PUBLIC_ORIGIN`. |
| `sub` | The host's id for the person, recorded with the nonce. |
| `firm` | The DripSign tenant id whose staff membership is checked. |
| `email` | The person's email, matched to that tenant's staff membership. |
| `iat`, `exp` | Unix seconds; at most 120 seconds apart, and `iat` at most 5 seconds ahead of DripSign's clock. |
| `jti` | 16 random bytes, base64url; DripSign records it once and refuses it again. |

`pnpm --filter @dripsign/web test` runs the verifier's tests, including a token
signed by an independent host implementation. With a running stack configured
with a local test key, `smoke/bridge.test.ts` signs as the host and checks that a
valid assertion opens that member's workspace and that replayed, forged, foreign,
expired, unlisted and foreign-tenant assertions open nothing; it needs
`DRIPSIGN_SMOKE_BRIDGE_SEED`, `DRIPSIGN_SMOKE_BRIDGE_HOST`,
`DRIPSIGN_SMOKE_BRIDGE_TENANT` and `DRIPSIGN_SMOKE_STAFF_EMAIL`, and is skipped
without the seed.

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
