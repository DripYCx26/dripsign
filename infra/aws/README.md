# AWS deployment

This template defines a standalone DripSign deployment in an operator-owned VPC and HTTPS ALB listener. It references a separately provisioned PostgreSQL database and dedicated secret. It contains no credentials or concrete AWS account identifiers. The native signer is not deployed by this repository change; task counts remain zero and production host routing remains disabled by default.

| File | Purpose |
| --- | --- |
| [stack.yaml](stack.yaml) | ECS web/jobs, dedicated roles, artifact bucket, secret containers, and conditional host routing |
| [database.sql](database.sql) | Administrator bootstrap for an isolated database and restricted runtime role |

## Prepare private configuration

Provision a dedicated PostgreSQL instance, or a logical `dripsign` database on an existing instance. Run `database.sql` once as an administrator outside the application. It intentionally fails if roles or the database already exist; inspect existing ownership before changing them. The administrator must be allowed to create roles and databases and to assume `dripsign_owner`. Set login passwords privately and store a full TLS connection URL for `dripsign_app` as the plaintext value of a dedicated Secrets Manager secret. The URL is `DRIPSIGN_DATABASE_URL`; the role must never be a V2 login or have V2 role memberships. If sharing an instance, revoke PUBLIC connection privilege on every unrelated database and explicitly regrant its legitimate users before deploying. PostgreSQL grants CONNECT to PUBLIC by default; a separate role alone does not prevent connecting to another database. A separate instance avoids that shared administrative dependency.

Supply the dedicated database security group, database secret ARN, private subnets with HTTPS egress, existing HTTPS listener ARN, ALB security group, verified SES identity ARN, exact sender address, and digest-pinned ECR image through private parameters. The template opens port 5432 only from DripSign task security groups to the supplied database security group. Supplying a V2 database security group or secret violates this template's contract.

The operator's listener must already have a certificate covering the staging hostname. `StagingHostname` creates the staging host rule. `EnableProductionHost=false` omits the `dripsign.com` rule. Enable it only after domain ownership, DNS, an attached certificate covering `dripsign.com`, and non-conflicting ALB priorities are ready. This template does not create certificates, DNS records, or change listener defaults. Audit any existing higher-priority path rules that could intercept `/health` or API paths before using the listener.

The initial task counts are zero. Creation makes empty web and jobs secret containers; fill their required JSON keys privately before increasing the counts. ECS injects the database URL and named secret keys at task startup. Rotation requires replacing tasks; an already running task does not receive changed values. The execution roles can read only their own config secret and the dedicated database secret. Runtime roles cannot read Secrets Manager or mutate IAM. The provided references assume the standard Secrets Manager encryption key; a private extension must grant exact `kms:Decrypt` permission for a customer-managed key.

## Migration identity and ledger

Keep a separate owner-capable TLS connection URL in private deployment configuration for migrations. It authenticates as `dripsign_migrator`, whose only role membership is `dripsign_owner`. The provided migration CLI calls `migrate(pool, true)`, which sets `SET LOCAL ROLE dripsign_owner` inside its migration transaction. A URL alone naming `dripsign_migrator` does not establish the effective owner role. `dripsign_owner` is a non-login role, so it is not a direct login credential.

Use only the `dripsign_app` URL for the ECS `DatabaseSecretArn` and injected `DRIPSIGN_DATABASE_URL`. The owner-capable URL remains private to the release operation; neither web nor jobs receive it. The runtime role has no schema ownership, schema CREATE privilege, owner membership, or permission to run migrations.

Default table grants apply to migration-created tables, including the migration ledger. Before starting or resuming either runtime after every migration pass, use the migration connection to revoke the ledger exception explicitly:

```sql
SET ROLE dripsign_owner;
REVOKE ALL PRIVILEGES ON TABLE dripsign.schema_migration FROM PUBLIC, dripsign_app;
```

The private release operation must verify that `dripsign_app` cannot insert, update, delete, truncate, or alter `dripsign.schema_migration`. Run the revocation even when the migration pass finds no new files. A failed migration or failed privilege finalization keeps runtime dispatch paused. The ledger records applied filenames and hashes; changing it could hide an edited or unapplied migration.

## Operate the service

Use the web secret for bridge and recipient session configuration. Use the jobs secret for private AI and host event configuration. The application-owned runtime contract is indexed in [the container README](../container/README.md). Retain both secret resources and the artifact bucket on stack deletion or replacement. The bucket blocks public access, requires TLS, encrypts objects with AES256, and versions every write. Runtime roles have no object deletion permission. Application revision/hash rules remain responsible for immutable evidence; S3 versioning alone does not prevent an overwrite.

DripSign owns the signing ceremony and records each required recipient's consent against the frozen published revision. Jobs generate and archive the signed PDF and audit record in the private artifact bucket. Agreement completion and host notification follow only after every required signature and both archived artifacts are recorded. Archive failures leave completion pending for recovery. Native signing needs no external signing endpoint, API key, webhook secret, or artifact-origin allowlist.

Jobs alone receive SES send permission, restricted by both the verified identity ARN and `ses:FromAddress` equal to the configured exact sender. SES verification, production access, DKIM, and delivery evidence are operator prerequisites. ECS private subnet egress is limited to TCP 443 and the dedicated database TCP 5432; NAT or equivalent reachable endpoints must exist. The host event destination is fixed in private application configuration, because an IP security group cannot enforce HTTPS hostnames.

Deploy and recover through [the private paired release contract](../paired-release.md). No public workflow assumes AWS roles or changes ECS, databases, secrets, SES, certificates, or DNS. Private configuration must not grant this public repository or any fork an AWS OIDC trust relationship.

## Reference

The template follows [ECS task definitions](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-taskdefinition.html), [ECS secret injection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html), [SES access control](https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html), and [PostgreSQL default privileges](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html).
