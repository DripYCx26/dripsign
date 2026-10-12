# Test ledger

The suite is minimal: a test stays only if it fails when its invariant breaks. Cases that need
a database run against a real PostgreSQL (`dripsign_test`).

## Kept

| Test | Proves |
|---|---|
| `packages/core/src/config.test.ts` (2) | A minimal dev environment parses; production without https, the dev sign-in off loopback or in production, and missing S3 keys are refused; Azure storage and email parse, half an Azure identity or half the completion-export pair is refused, and production refuses file storage |
| `packages/core/src/domain/policy.test.ts` (1) | Every allowed action derives from lifecycle state and capacity: the one home of permissions; only a pending proposal's author may withdraw it, and staff neither publish nor request signatures while a recipient's proposal waits |
| `packages/core/src/domain/evidence.test.ts` (1) | The database refuses a signature verified after it was signed, an edited signature, a round that skips signing or finalizing, and `signed` without both artifacts; a signature in the same millisecond as finalizing stays in the audit timeline |
| `packages/core/src/domain/lifecycle.test.ts` (3) | Negotiate, publish, sign (with request evidence, a verification older than the signing window refused with nothing recorded, a re-verification racing the last signature) and archive to `signed`; completion under undeliverable export pins freezes nothing and is listed as held, and once the pins are fixed, an admin revoked while recovery waits on the round lock is refused and two admins recovering it at once freeze and queue it exactly once; cancel signing only by a signer's proposal, void on removal, and one signer order for staging, publication, the signature page and the audit record; a stale save is fenced, an upload survives a rename, a refused PDF shows staff the worker's sentence, receipts replay, only the author withdraws a pending proposal, export pins with another issuer, audience, key id or key version are refused, authority is rechecked after lock waits (a command, a create replay, and a pins save queued behind an uncommitted revocation), and the last admin cannot step down |
| `packages/core/src/auth/auth.test.ts` (2) | Five wrong codes lock a challenge, email budgets stop mail, an unknown email answers alike; staff and recipient capacity resolve for one email, a revoked grant drops, and a host bridge session never reads the email's inbox |
| `packages/core/src/host/host.test.ts` (2) | The bridge token is accepted once; forged, expired, over-long-lived or misaddressed ones are refused; an embed session wins over a native cookie and a dead one fails closed; the executed event signs byte for byte like the host's vector |
| `packages/core/src/adapters/azure.test.ts` (1) | A blob is written once and an existing one is trusted only after reading the same bytes; mail is never resent once accepted |
| `packages/core/src/pdf/pdf.test.ts` (2) | Unrenderable names are refused; signer fields and deterministic, hash-sensitive redacted evidence are verified; unsafe uploads and single/cumulative inflation bombs are refused; concurrent large multi-page uploads succeed; cancellation is preserved; a discarded script OpenAction, GoTo and four Named navigation actions, and Link URI/mailto chains are accepted while page or non-Link URI actions, unsafe `/Next` chains (including arrays), `/AA` on any copied object, embedded attachments and signed signature fields are refused |
| `packages/core/src/jobs/jobs.test.ts` (4) | Archive survives storage failures with fenced leases, rescue, capped backoff and confidential logs; claims and AI spend are fenced (the provider is never called twice), retries classified, leases renewed and retention batched; two concurrent `ask_ai` calls at the daily cap admit exactly one; test claims leave other files' jobs alone; the demo seed is refused in production |
| `apps/web/src/server/request.test.ts` (1) | Request evidence keeps only a client address a trusted proxy hop count supports, and a user agent bounded to 500 characters |
| `apps/web/src/features/workspace/tabs.test.ts` (1) | The rail and the phone's default tab count messages and proposals only: no conversation and no composer means no rail, history alone a narrow rail, a composer without talk opens on the document |
| `apps/web/src/features/workspace/nextStep.test.ts` (1) | The primary action for every role and state matches the table, worded from the policy's allowed actions (the staff move the list rows share), including a ready draft in review with no required signer |
| `apps/web/src/features/thread/thread.test.ts` (5) | Only a plain Enter sends; another identity on the tab drops the previous person's stored text; a send that succeeds late keeps text typed meanwhile; the chat shows milestones only, says "You" for the viewer's signature, groups one minute and carries the void reason; a countered proposal folds into the live card (same row count, new newest key), a withdrawn one keeps its card, and times show on the first, the last and after a pause |
| `apps/web/src/features/document/diff.test.ts` (9) | Section diffs mark unchanged, added, removed, word-changed, paragraph-added, reordered and retitled text, and a first revision as all added; each section edited in place keeps its heading unless the caller already names it |
| `tools/check-docs.test.mjs` (5) | The docs gate flags missing READMEs, dead listings and links, an oversized contract, and undocumented config keys |
| `e2e/smoke.spec.ts` (1, browser) | The money path through the real UI: dev sign-in, create, publish, request signatures, recipient signs, the signed PDF downloads as a PDF |

## Deleted

| Deleted | Covered by |
|---|---|
| The previous build's tests: none existed | Not applicable |

## Risks

- Database triggers other than the signature, round and completion gates are exercised only
  through the domain and jobs cases; no test attacks each trigger directly.
- Server actions, route handlers, CSP and the pdf.js viewer have no unit coverage; the browser
  smoke is the only reach.
- Memory use of the isolated upload parser is bounded by the inflation budget and worker limits;
  no test measures process memory.
- Email delivery is at-least-once; a duplicate after a crash is accepted and untested.
- The Azure template and the S3 and SES adapters are untested against the real services.
