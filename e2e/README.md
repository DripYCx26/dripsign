# e2e/

**Job:** the browser smoke test, the only one: the V1 money path through the real UI.

`smoke.spec.ts` signs in as Avery Chen (dev sign-in), creates a services agreement for Jordan
Lee, waits for the worker to prepare the PDF, publishes and requests signatures. It then signs in
as Jordan, reviews and signs, and waits for the worker to archive the signed PDF, which it
downloads and checks is a PDF.

## Run it

```bash
pnpm dev                      # web, worker, Postgres, Mailpit; seeded
pnpm exec playwright test     # reuses a running server, or starts pnpm dev
```

Each run leaves one synthetic agreement behind; `pnpm db:reset` clears them.
