# infra/

Deployment artifacts that hold no identifiers or credentials.

## Subdirectories

| Path | What |
|---|---|
| `container/` | The one image run as web and as worker |

## Production

DripSign runs as two processes of the same image: web and worker ([container](container/README.md)).
An operator supplies:

| Need | Notes |
|---|---|
| PostgreSQL 17 | Two roles: an owner for `cli migrate`, a runtime role for web and worker |
| S3 bucket | Document and artifact storage; optional KMS key in `DRIPSIGN_S3_KMS_KEY_ID` |
| SES identity | Verified sender for `DRIPSIGN_EMAIL_FROM`; production sending enabled |
| https origin | Behind a proxy; set `DRIPSIGN_TRUSTED_PROXY_HOPS` to its hop count |

Required in production, enforced at startup by `packages/core/src/config.ts`:

- `NODE_ENV=production`, with `DRIPSIGN_DEV_LOGIN` unset or `0`
- `DRIPSIGN_DATABASE_URL`, `DRIPSIGN_PUBLIC_ORIGIN` (https), `DRIPSIGN_AUTH_SECRET` (32+ bytes)
- `DRIPSIGN_STORAGE=s3` with `DRIPSIGN_S3_BUCKET` and `AWS_REGION`
- `DRIPSIGN_EMAIL_TRANSPORT=ses` with `DRIPSIGN_EMAIL_FROM`

Optional keys (AI, host integration, concurrency) are described in [`.env.example`](../.env.example).
Run `pnpm --filter @dripsign/core cli migrate` with the owner role before starting either process;
the schema has no migration chain, so a changed baseline needs a rebuilt database.
