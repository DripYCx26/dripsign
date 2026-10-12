# DripSign — Agent Contract

DripSign is an open source agreement workspace: staff prepare an agreement, recipients negotiate
in a turn-based thread beside the document, staff publish immutable revisions, signers sign with a
typed name, and a worker archives the signed PDF and audit record. One Next.js app, one Node
package for everything that decides, PostgreSQL.

## The rules that matter most

1. **The database guards evidence.** Revisions, signatures, artifacts and messages are immutable
   by trigger; the signing round state machine and the completion gate live in SQL. Never weaken
   a trigger to make code easier.
2. **One home per rule.** Lifecycle and permissions live in `packages/core/src/domain/policy.ts`;
   validation and limits in `packages/core/src/schema.ts`; configuration in
   `packages/core/src/config.ts`. Search for the owner before writing; delete what a change
   supersedes in the same diff.
3. **No backward compatibility before customers.** `packages/core/schema/schema.sql` is one
   baseline edited in place. No shims, versioned names or migration chains.
4. **Formatting is mechanical and checked.** Prettier at 100 columns; strict ESLint; strict
   TypeScript. Never cram code to fit a limit.
5. **Evidence:** never invent state, results or readiness. Report the command and result of
   checks you ran; label what you did not run.

Product decisions are dated in `docs/DECISIONS.md`; a new entry supersedes an old one.

| Load when | Read |
|---|---|
| always | this file |
| touching any directory | its nearest `README.md`; root `README.md` for where things live |
| crossing the core/web boundary or changing a mechanism | `docs/ARCHITECTURE.md` |
| touching persistence, signing, sessions or jobs | `packages/core/README.md` |
| touching a screen, component or token | `apps/web/README.md`, `apps/web/src/ui/README.md` |
| writing Next.js code | `apps/web/AGENTS.md` (this Next version differs from training data) |
| adding, changing or deleting a test | `TEST_LEDGER.md` |
| choosing a dependency or boundary | `docs/DECISIONS.md` |

## Non-negotiables

- **Authority is rechecked.** Every read and command resolves the session's capacity (staff for
  a tenant, or recipient of one agreement) from the database on the request that uses it.
- **Signing is exact.** A signature binds the frozen round, revision and document hash, a fresh
  email verification and the verbatim consent text. Nothing edits a finalizing round.
- **Confidentiality:** recipients never see drafts, AI suggestions or other recipients' emails;
  logs hold ids, never bodies, codes or tokens.
- **Noise is a defect:** warnings, stray output, duplicate docs, stale references.
- A task implies no spend, publication, production access or customer contact. Use synthetic
  data (`.test` addresses) and local services.

## Boundaries

`packages/core` is Next-free and decides: schema, domain, auth, PDF, adapters, worker, CLI.
`apps/web` presents and transports: pages, server actions, route handlers, components. PDFs are
rendered only by the worker. The dev sign-in exists only when `DRIPSIGN_DEV_LOGIN=1`, the
environment is not production and the origin is loopback; config refuses to start otherwise.

## Verification

```bash
tools/ci            # static, types, test, build
tools/ci e2e        # browser smoke against `pnpm dev`
```

Tests use a real PostgreSQL (`docker compose up -d --wait`). Keep the suite minimal: a test must
fail when its invariant breaks; record it in `TEST_LEDGER.md`.

## Commits

No AI attribution; the author is the repository owner. Imperative subject under 72 characters;
the body says why. Small coherent commits go straight to `main`; never force-push.

## Working rules

One writer per file at a time. If blocked, record it and take other work. Never report false
Done. This file stays under 100 lines (`tools/check-docs.mjs`).
