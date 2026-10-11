# infra/

Deployment artifacts that hold no identifiers or credentials.

## Subdirectories

| Path | What |
|---|---|
| `aws/` | CloudFormation: ECS Fargate web and worker, a migrate task, S3, SES and Secrets Manager |
| `azure/` | Terraform: Container Apps web and worker, release jobs, Blob, Communication Services, Key Vault, Front Door, PostgreSQL |
| `container/` | The one image run as web and as worker |

## Production

DripSign runs as two processes of one image, web and worker ([container](container/README.md)),
on AWS ([aws](aws/README.md)) or Azure ([azure](azure/README.md)); the configuration picks the
adapters. [`database.sql`](database.sql) bootstraps both templates' PostgreSQL 17 database: an
owner login (`dripsign_migrator`) for `cli migrate` and a data-only runtime login (`dripsign_app`).
An operator supplies:

| Need | AWS | Azure |
|---|---|---|
| Document storage | S3 bucket; optional KMS key in `DRIPSIGN_S3_KMS_KEY_ID` | Blob container, reached with the app's managed identity |
| Email | Verified SES identity for `DRIPSIGN_EMAIL_FROM` | Communication Services Email domain |
| https origin | ALB listener with a certificate; `DRIPSIGN_TRUSTED_PROXY_HOPS` is its hop count | Front Door; the template sets the hop count |

Required in production, enforced at startup by `packages/core/src/config.ts`:

- `NODE_ENV=production`, with `DRIPSIGN_DEV_LOGIN` unset or `0`
- `DRIPSIGN_DATABASE_URL`, `DRIPSIGN_PUBLIC_ORIGIN` (https), `DRIPSIGN_AUTH_SECRET` (32+ bytes)
- `DRIPSIGN_STORAGE=s3` with `DRIPSIGN_S3_BUCKET` and `AWS_REGION`, or `azure` with
  `DRIPSIGN_AZURE_BLOB_ENDPOINT` and `DRIPSIGN_AZURE_BLOB_CONTAINER`
- `DRIPSIGN_EMAIL_TRANSPORT=ses` or `azure` (with `DRIPSIGN_AZURE_EMAIL_ENDPOINT`), and
  `DRIPSIGN_EMAIL_FROM`

Optional keys (AI, host integration, completion export, concurrency) are described in
[`.env.example`](../.env.example). Migrate before starting either process: run
`pnpm --filter @dripsign/core cli migrate` with the owner login (each template has a one-off task
or job for it). The schema has no migration chain, so a changed baseline needs a rebuilt database.
