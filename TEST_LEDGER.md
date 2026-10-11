# Test ledger

The suite is minimal: a test stays only if it fails when its invariant breaks. Cases that need
a database run against a real PostgreSQL (`dripsign_test`).

## Kept

| Test | Proves |
|---|---|
| `packages/core/src/config.test.ts` (2) | A minimal dev environment parses; production without https, the dev sign-in off loopback or in production, and missing S3 keys are refused; Azure storage and email parse, half an Azure identity or half the completion-export pair is refused, and production refuses file storage |
| `packages/core/src/domain/policy.test.ts` (1) | Every allowed action derives from lifecycle state and capacity: the one home of permissions |
| `packages/core/src/domain/evidence.test.ts` (1) | The database refuses a signature verified after it was signed, an edited signature, a round that skips signing or finalizing, and `signed` without both artifacts |
| `packages/core/src/domain/lifecycle.test.ts` (3) | Negotiate, publish, sign (with request evidence, a re-verification racing the last signature) and archive to `signed`; cancel signing only by a signer's proposal, void on removal, and one signer order for staging, publication, the signature page and the audit record; a stale save is fenced, an upload survives a rename, receipts replay, authority is rechecked after lock waits, and the last admin cannot step down |
| `packages/core/src/auth/auth.test.ts` (2) | Five wrong codes lock a challenge, email budgets stop mail, an unknown email answers alike; staff and recipient capacity resolve for one email and a revoked grant drops |
| `packages/core/src/host/host.test.ts` (2) | The bridge token is accepted once; forged, expired, over-long-lived or misaddressed ones are refused; an embed session wins over a native cookie and a dead one fails closed; the executed event signs byte for byte like the host's vector |
| `packages/core/src/adapters/azure.test.ts` (1) | A blob is written once and an existing one is trusted only after reading the same bytes; mail is never resent once accepted |
| `packages/core/src/pdf/pdf.test.ts` (1) | Unrenderable names are refused; signer fields and deterministic, hash-sensitive redacted evidence are verified; unsafe uploads and single/cumulative inflation bombs are refused; concurrent large multi-page uploads succeed; cancellation is preserved |
| `packages/core/src/jobs/jobs.test.ts` (3) | Archive survives storage failures with fenced leases, rescue, capped backoff and confidential logs; claims and AI spend are fenced, retries classified, leases renewed and retention batched; two concurrent `ask_ai` calls at the daily cap admit exactly one |
| `apps/web/src/server/request.test.ts` (1) | Request evidence keeps only a client address a trusted proxy hop count supports, and a user agent bounded to 500 characters |
| `apps/web/src/features/workspace/tabs.test.ts` (1) | The rail and the phone's default tab count messages and proposals only: no conversation and no composer means no rail, history alone a narrow rail, a composer without talk opens on the document |
| `apps/web/src/features/workspace/nextStep.test.ts` (1) | The primary action for every role and state matches the table |
| `apps/web/src/features/thread/thread.test.ts` (3) | Only a plain Enter sends; another identity on the tab drops the previous person's stored text; the chat shows milestones only, says "You" for the viewer's signature and groups one minute |
| `apps/web/src/features/document/diff.test.ts` (8) | Section diffs mark unchanged, added, removed, word-changed, paragraph-added, reordered and retitled text, and a first revision as all added |
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
