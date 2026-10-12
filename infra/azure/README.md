# Azure deployment

This Terraform root defines a standalone DripSign deployment on Azure Container Apps. It mirrors
the [AWS template](../aws/README.md) in scope: one image run as a web app and a worker app with
their own identities, private document storage, a secret store, mail, a dedicated database, and an
HTTPS edge. It contains no credentials, subscription identifiers, or host names. Nothing serves
until the operator raises the replica counts, and no custom domain exists until `host` is set.

| File | Purpose |
| --- | --- |
| [versions.tf](versions.tf) | Exact Terraform and provider versions; a partial `azurerm` backend block |
| [providers.tf](providers.tf) | azurerm with Entra-only storage access and no provider registration; azapi for secret writes |
| [variables.tf](variables.tf) | What the operator chooses: names, region, images, host, mail domain, sizes, replica counts, optional features |
| [locals.tf](locals.tf) | Address plan, identities, the secret each identity may read, and the app settings (the one place the environment names live) |
| [network.tf](network.tf) | Resource group, VNet, apps and data subnets, static egress address, private DNS for the database |
| [compute.tf](compute.tf) | Log workspace, Container Apps environment, identities, web and worker apps, release jobs |
| [database.tf](database.tf) | PostgreSQL 17 Flexible Server with private access only, its parameters and delete lock |
| [storage.tf](storage.tf) | Document account and container, read-and-create role, access logs and delete lock |
| [vault.tf](vault.tf) | Key Vault, its audit log, generated and operator secrets, per-secret reader grants |
| [mail.tf](mail.tf) | Communication Services Email, its sending domain, and the worker identity's send role |
| [edge.tf](edge.tf) | Front Door Standard profile, endpoint, optional custom domain, origin and HTTPS-redirect route |
| [outputs.tf](outputs.tf) | Public origin, DNS records to write, egress address, sender, release job names |
| [.terraform.lock.hcl](.terraform.lock.hcl) | Provider hashes, committed so every run resolves the same binaries |

## What it creates

- **Runtimes.** A workload-profile Container Apps environment in the apps subnet. The web app
  (`pnpm --filter @dripsign/web start`, port 3000, readiness `/api/health`) and the worker app
  (`pnpm --filter @dripsign/core worker`, no ingress) each run under their own user-assigned
  identity. `web_replicas` and `worker_replicas` default to zero, which creates neither app;
  Container Apps cannot hold an HTTP app at zero without starting it on the first request.
- **Documents.** A StorageV2 account with shared keys disabled, OAuth by default, versioning,
  35-day blob and container soft delete, infrastructure encryption, and a network rule that admits
  only the apps subnet. The web and worker identities hold a custom role on the `documents`
  container that can read and create blobs but cannot overwrite or delete them. The apps select
  the Azure Blob adapter with `DRIPSIGN_STORAGE=azure`.
- **Secrets.** One Key Vault with RBAC, purge protection, and a data plane that admits only the apps
  subnet. Each identity is granted `Key Vault Secrets User` on exactly the secrets it needs, and the
  apps read them as Key Vault references. Generated values (database passwords and URLs, the session
  secret) are ephemeral and are written through the control plane, so no secret value enters state,
  a plan, or a log.
- **Mail.** Communication Services Email connected to the Azure-managed domain by default, with
  engagement tracking off. The worker identity alone may send, with `DRIPSIGN_EMAIL_TRANSPORT=azure`.
- **Database.** A PostgreSQL 17 Flexible Server on a delegated subnet with no public endpoint,
  TLS 1.2 or later, SCRAM passwords, and no statement or parameter text in its logs. Terraform
  creates no database object; the `database` job runs [database.sql](../database.sql), which makes
  `dripsign_migrator` the database owner and gives `dripsign_app` data access only.
- **Edge.** Front Door Standard routes `/*` to the web app over HTTPS, redirects HTTP to HTTPS, and
  caches nothing. Until `host` is set, the deployment serves on the Front Door endpoint host and
  `DRIPSIGN_PUBLIC_ORIGIN` is that host.
- **Egress.** A NAT gateway with one static address for outbound calls to the AI provider.

## Environment mapping

[locals.tf](locals.tf) is the one place that sets the application's environment; the names are
parsed by [`config.ts`](../../packages/core/src/config.ts) and listed in
[`.env.example`](../../.env.example).

| Variable | Where it comes from |
| --- | --- |
| `NODE_ENV`, `DRIPSIGN_PUBLIC_ORIGIN`, `DRIPSIGN_TRUSTED_PROXY_HOPS` | fixed, the Front Door host or `host`, `trusted_proxy_hops` |
| `DRIPSIGN_STORAGE=azure`, `DRIPSIGN_AZURE_BLOB_ENDPOINT`, `DRIPSIGN_AZURE_BLOB_CONTAINER` | the document account and container |
| `DRIPSIGN_EMAIL_TRANSPORT=azure`, `DRIPSIGN_AZURE_EMAIL_ENDPOINT`, `DRIPSIGN_EMAIL_FROM` | the Communication Services resource and sending domain |
| `AZURE_CLIENT_ID`; `IDENTITY_ENDPOINT`, `IDENTITY_HEADER` | the app's identity; set by Container Apps |
| `DRIPSIGN_DATABASE_URL`, `DRIPSIGN_AUTH_SECRET` | Key Vault secrets `database-url`, `auth-secret` |
| `DRIPSIGN_ANTHROPIC_API_KEY` | Key Vault secret `anthropic-api-key`, web and worker, only with `ai_enabled` |
| `DRIPSIGN_HOST` | `host_integration`, web and worker, plain (public settings); unset when null |

Not set, so the defaults apply: `DRIPSIGN_AI_MODEL`, `DRIPSIGN_AI_DAILY_LIMIT_USD`,
`DRIPSIGN_JOBS_CONCURRENCY`, `DRIPSIGN_S3_*`, `AWS_REGION`, `DRIPSIGN_SMTP_URL`. Production refuses
file storage, SMTP and the dev sign-in.

## What the operator supplies

- A subscription where the operator can create role assignments and custom roles (Owner, or
  Contributor with User Access Administrator), and these resource providers registered once with
  `az provider register --namespace <namespace>`: `Microsoft.App`, `Microsoft.Cdn`,
  `Microsoft.Communication`, `Microsoft.DBforPostgreSQL`, `Microsoft.KeyVault`,
  `Microsoft.ManagedIdentity`, `Microsoft.Network`, `Microsoft.OperationalInsights`,
  `Microsoft.Storage`.
- A state storage account and a private backend file naming it.
- The DripSign image and a PostgreSQL 17 client image (`psql`), both pinned by digest. A private
  registry is optional: set `registry` and each identity receives `AcrPull` on it.
- Optional features, each off by default: `ai_enabled` with `operator_secrets.anthropic_api_key`;
  `host_integration` for a Dreach host app's staff entry. `operator_secrets` is ephemeral:
  Terraform writes the values only when the secret is created or `operator_secrets_version`
  changes and never records them.
- For a custom host: the domain, then the CNAME and `_dnsauth` TXT records from `dns_records`.
- For production mail volume: a sending domain in `mail_domain`, then its verification, SPF, and
  DKIM records from `dns_records`. The Azure-managed domain has very low sending limits.

There is no test mailbox: production refuses SMTP and file mail, so a test environment runs the
local stack ([`tools/README.md`](../../tools/README.md)) instead.

## Commands

From this directory, with `az login` done and the values in a private `.tfvars` file:

```sh
terraform init -backend-config=<private backend file>
export TF_VAR_operator_secrets='{"anthropic_api_key":"..."}'
terraform plan -var-file=<private tfvars> -out=dripsign.tfplan
terraform apply dripsign.tfplan
```

The first apply creates everything except the two apps. Prepare the database inside the VNet, then
start the apps. Migrate before starting either app, and again before a release that changes
`schema.sql`:

```sh
az containerapp job start --resource-group <name> --name <name>-database   # roles, database, passwords
az containerapp job start --resource-group <name> --name <name>-migrate    # cli migrate as dripsign_migrator
az containerapp job start --resource-group <name> --name <name>-staff \
  --args --filter @dripsign/core cli add-staff --tenant <tenant> --email <email> --role admin
terraform plan -var-file=<private tfvars> -var web_replicas=1 -var worker_replicas=1 -out=dripsign.tfplan
terraform apply dripsign.tfplan
```

Check each job execution with `az containerapp job execution list` before starting the next.
`migrate` creates the schema in an empty database and does nothing when it is current; a stale
schema fails, because the baseline has no migration chain and needs a rebuilt database. The
`staff` job's arguments are the only way to add staff (`add-staff` is idempotent and also revives a
revoked member). A role assignment can take minutes to reach Key Vault; if the first app revision
cannot read a secret, apply again.

To validate without Azure access: `terraform init -backend=false`, `terraform fmt -check`, and
`terraform validate`.

## Rotation

- Database passwords: bump `db_credential_version`, apply, run the `database` job, then restart both
  apps so they read the new URL.
- Session secret: bump `auth_secret_version`, apply, and restart the web and worker apps. Every
  session ends.
- Operator secrets: set the new values in `operator_secrets`, bump `operator_secrets_version`,
  apply, and restart the apps that read them.

A running revision keeps the values it started with until it restarts.

## Limits and residual risks

- The web app's own ingress host also answers on the internet. Front Door Standard cannot reach a
  Container Apps origin privately, and Container Apps IP rules accept only address ranges. The app
  enforces its exact `DRIPSIGN_PUBLIC_ORIGIN` for mutations, sessions, and redirects.
- `trusted_proxy_hops` defaults to 2 (Front Door, then the Container Apps ingress). It is an
  assumption about how those proxies append to `X-Forwarded-For`; check the address the app
  records against a request you made before relying on per-address limits.
- The storage account resource exposes access keys to Terraform state even though shared-key
  authorization is disabled, so the keys cannot authorize requests. Restrict state access.
- No narrower built-in role for managed-identity mail sending is documented, so the worker identity
  holds Contributor on the Communication Services resource alone.
- The `database` job connects with `sslmode=require` inside the VNet. The Node processes use
  `sslmode=verify-full`.
- The `database` job sets `createrole_self_grant` for its session so that the administrator can
  assume `dripsign_migrator` on PostgreSQL 16 and later. If the server refuses that setting, grant
  the administrator `SET` and `INHERIT` on `dripsign_migrator` before running the bootstrap.
- The `staff` job relies on `az containerapp job start --args` replacing the container arguments;
  if your CLI version does not, run the same command from a machine inside the VNet.
- Initial sizes (0.5 vCPU and 1 GiB per container, a Burstable database) are assumptions for a
  trial, not measured capacity.
- Nothing in this template has been applied. `terraform validate` proves only that the
  configuration matches the pinned provider schemas.

## Reference

[Container Apps managed identity](https://learn.microsoft.com/azure/container-apps/managed-identity),
[Key Vault references in Container Apps](https://learn.microsoft.com/azure/container-apps/manage-secrets),
[Put Blob](https://learn.microsoft.com/rest/api/storageservices/put-blob),
[Blob conditional headers](https://learn.microsoft.com/rest/api/storageservices/specifying-conditional-headers-for-blob-service-operations),
[Storage service versions](https://learn.microsoft.com/rest/api/storageservices/versioning-for-the-azure-storage-services),
[Communication Services Email REST specification](https://github.com/Azure/azure-rest-api-specs/tree/main/specification/communication/data-plane/Email),
and [PostgreSQL role membership](https://www.postgresql.org/docs/current/runtime-config-client.html).
