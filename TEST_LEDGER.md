# Test ledger

The suite is minimal: a test stays only if it fails when its invariant breaks. Cases that need
a database run against a real PostgreSQL (`dripsign_test`).

## Kept

| Test | Proves |
|---|---|
| `packages/core/src/config.test.ts` (1) | A minimal dev environment parses; production without https, s3, ses, or with the dev sign-in is refused |
| `packages/core/src/domain/policy.test.ts` (1) | Every allowed action derives from lifecycle state and capacity: the one home of permissions |
| `packages/core/src/auth/auth.test.ts` (2) | Five wrong codes lock a challenge, email budgets stop mail, unknown email answers alike; staff and recipient capacity resolve for one email and a revoked grant drops |
| `packages/core/src/host/host.test.ts` (2) | The bridge token is accepted once and forged, expired or misaddressed ones are refused; the executed event signs byte for byte like the host's vector |
| `packages/core/src/pdf/pdf.test.ts` (1) | Unrenderable names are refused before rendering; signer fields are prepared; signed PDF and audit render deterministically |
| `packages/core/src/jobs/jobs.test.ts` (3) | Archive survives storage failures with artifact hashes preserved and stale lease finishes refused; no double claim, expired leases reclaim, a reclaimed AI job fails and keeps its spend; two concurrent `ask_ai` calls at the daily cap admit exactly one |
| `apps/web/src/features/workspace/nextStep.test.ts` (1) | The primary action for every role and state matches the table |
| `apps/web/src/features/document/diff.test.ts` (6) | Section diffs mark unchanged, added, removed, word-changed and retitled text |
| `tools/check-docs.test.mjs` (5) | The docs gate flags missing READMEs, dead listings and links, an oversized contract, and undocumented config keys |
| `e2e/smoke.spec.ts` (1, browser) | The money path through the real UI: dev sign-in, create, publish, request signatures, recipient signs, the signed PDF downloads as a PDF |

## Deleted

| Deleted | Covered by |
|---|---|
| The previous build's tests: none existed | Not applicable |

## Risks

- Database triggers (immutable evidence, signing state machine, completion gate) are exercised
  only through the jobs and domain cases above; no test attacks each trigger directly.
- Server actions, route handlers, CSP and the pdf.js viewer have no unit coverage; the browser
  smoke is the only reach.
- Email delivery is at-least-once; a duplicate after a crash is accepted and untested.
