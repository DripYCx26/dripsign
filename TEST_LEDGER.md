# Test ledger

The suite is minimal: a test stays only if it fails when its invariant breaks. Cases that need
a database run against a real PostgreSQL (`dripsign_test`).

## Kept

| Test | Proves |
|---|---|
| `packages/core/src/config.test.ts` (2) | A minimal dev environment parses; production without https, the dev sign-in off loopback or in production, and missing S3 keys are refused; Azure storage and email parse, half an Azure identity is refused, and production refuses file storage |
| `packages/core/src/domain/policy.test.ts` (1) | Every allowed action derives from lifecycle state and capacity: the one home of permissions; only a pending proposal's author may withdraw it, and staff neither publish nor request signatures while either side's proposal waits |
| `packages/core/src/domain/evidence.test.ts` (1) | The database refuses a signature verified after it was signed, an edited signature, a round that skips signing or finalizing, and `signed` without both artifacts; a signature in the same millisecond as finalizing stays in the audit timeline |
| `packages/core/src/domain/lifecycle.test.ts` (3) | Negotiate, publish, sign (with request evidence, a verification older than the signing window refused with nothing recorded, a re-verification racing the last signature, each signature carrying its PDF face) and archive to `signed`; cancel signing only by a signer's proposal, void on removal, and one signer order for staging, publication, the signature page and the audit record; a proposal rewrites exactly one section, staff edits to other sections survive accepting it and accepting a section staff removed is refused, a new draft prepares before it has a signer, a save's title becomes the agreement title and a stale save is fenced, terms the renderer refuses show staff its sentence, receipts replay, only the author withdraws a pending proposal and the withdrawal is on the timeline as theirs, authority is rechecked after lock waits (a command, a create replay, and a roster change queued behind an uncommitted revocation), and the last admin cannot step down |
| `packages/core/src/auth/auth.test.ts` (2) | Five wrong codes lock a challenge, email budgets stop mail, an unknown email answers alike; staff and recipient capacity resolve for one email, a revoked grant drops, and a host bridge session never reads the email's inbox |
| `packages/core/src/host/host.test.ts` (1) | The bridge token is accepted once; forged, expired, over-long-lived or misaddressed ones are refused; an embed session wins over a native cookie and a dead one fails closed |
| `packages/core/src/adapters/azure.test.ts` (1) | A blob is written once and an existing one is trusted only after reading the same bytes; mail is never resent once accepted |
| `packages/core/src/pdf/pdf.test.ts` (1) | Unrenderable names are refused; a Latin signature is drawn in Newsreader Italic and a Cyrillic one falls back to Noto Sans, in the face the name check returns, with the evidence line; signer fields and deterministic, hash-sensitive redacted evidence are verified |
| `packages/core/src/jobs/jobs.test.ts` (4) | Archive survives storage failures with fenced leases, rescue, capped backoff and confidential logs; claims and AI spend are fenced (the provider is never called twice), cost is priced, a failed or unanswered renewal holds the job only until the claimed lease ends and a lost lease ends it, delivered email parameters are scrubbed, retention is batched; two concurrent `ask_ai` calls at the daily cap admit exactly one, and terms longer than the assistant can return are refused before any reservation; test claims leave other files' jobs alone; the demo seed is refused in production |
| `apps/web/src/server/request.test.ts` (1) | Request evidence keeps only a client address a trusted proxy hop count supports, and a user agent bounded to 500 characters |
| `apps/web/src/features/workspace/tabs.test.ts` (1) | The rail and the phone's default tab count messages and proposals only: no conversation and no composer means no rail, history alone a narrow rail, a composer without talk opens on the document |
| `apps/web/src/features/workspace/nextStep.test.ts` (1) | The primary action for every role and state matches the table, worded from the policy's allowed actions (the staff move the list rows share), including a ready draft in review with no required signer |
| `apps/web/src/features/command/adopt.test.ts` (1) | A read or write response changes the display only if no newer request started and the server view it started from is still adopted, so a late read never restores an older version |
| `apps/web/src/features/thread/thread.test.ts` (5) | Only a plain Enter sends; another identity on the tab drops the previous person's stored text; a send that succeeds late keeps text typed meanwhile; the chat shows milestones only, says "You" for the viewer's signature, groups one minute and carries the void reason; a countered proposal folds into the live card (same row count, new newest key), a withdrawn one keeps its card, and times show on the first, the last and after a pause |
| `apps/web/src/features/document/diff.test.ts` (9) | Section diffs mark unchanged, added, removed, word-changed, paragraph-added, reordered and retitled text, and a first revision as all added; each section edited in place keeps its heading unless the caller already names it |
| `tools/check-docs.test.mjs` (5) | The docs gate flags missing READMEs, dead listings and links, an oversized contract, and undocumented config keys |
| `e2e/smoke.spec.ts` (1, browser) | The money path through the real UI: dev sign-in, create, publish, request signatures, recipient signs, the signed PDF downloads as a PDF |

## Deleted

| Deleted | Covered by |
|---|---|
| The previous build's tests: none existed | Not applicable |
| Upload safety: active content, inflation bombs, the parser queue and cancellation (`pdf.test.ts`); an upload kept on rename (`lifecycle.test.ts`) | Nothing: uploaded PDFs were removed on 2026-10-11 |
| Completion export: the executed-event vector (`host.test.ts`), held and recovered exports and pin checks (`lifecycle.test.ts`), the export pair in `config.test.ts`, host-event retry classes (`jobs.test.ts`) | Nothing: completion export was removed on 2026-10-11 |

## Risks

- Database triggers other than the signature, round and completion gates are exercised only
  through the domain and jobs cases; no test attacks each trigger directly.
- Server actions, route handlers, CSP and the pdf.js viewer have no unit coverage; the browser
  smoke is the only reach.
- Email delivery is at-least-once; a duplicate after a crash is accepted and untested.
- The Azure template and the S3 and SES adapters are untested against the real services.
