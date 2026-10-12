# AWS deployment

This CloudFormation template defines a standalone DripSign deployment in an operator-owned VPC
behind an HTTPS ALB listener: one image run as a web service and a worker service on private
ECS Fargate, a one-off migrate task, a private S3 bucket, and Secrets Manager containers. It
references a separately provisioned PostgreSQL database. It contains no credentials or concrete
AWS account identifiers. Service counts default to zero, so nothing runs until the operator raises
them.

| File | Purpose |
| --- | --- |
| [stack.yaml](stack.yaml) | ECS web and worker, the migrate task, dedicated roles, the document bucket, secret containers, and the host routing rule |

## Prepare private configuration

Provision a dedicated PostgreSQL 17 instance, or a logical `dripsign` database on an existing one.
Run [`database.sql`](../database.sql) once as an administrator. It fails if the roles or the
database already exist; inspect existing ownership before changing them. It creates
`dripsign_migrator`, which owns the database and runs `cli migrate`, and `dripsign_app`, the runtime
login with data access only. Set both passwords privately and store two full TLS connection URLs as
the plaintext values of two Secrets Manager secrets: `dripsign_app` for `DatabaseSecretArn` and
`dripsign_migrator` for `MigrationDatabaseSecretArn`. PostgreSQL grants CONNECT to PUBLIC by
default; on a shared instance revoke it on every unrelated database, because a separate role alone
does not prevent connecting elsewhere.

Supply the database security group, the two secret ARNs, private subnets with HTTPS egress, the
existing HTTPS listener ARN and its ALB security group, a verified SES identity ARN, the exact
sender address, `Hostname` and `ListenerRulePriority`, and a digest-pinned ECR image through private
parameters. The template opens port 5432 only from the web, worker and migrate security groups to
the database group. The listener must already hold a certificate covering `Hostname`; the template
creates no certificates or DNS records and does not touch the listener default action. Audit any
higher-priority rule that could intercept `/api/health` or the application paths.

Creation makes two empty config secrets. Fill them privately before raising a service count:

| Secret | Keys |
| --- | --- |
| `WebConfig` | `DRIPSIGN_AUTH_SECRET` (32+ bytes); `DRIPSIGN_ANTHROPIC_API_KEY` when `AiEnabled=true` |
| `WorkerConfig` | `DRIPSIGN_AUTH_SECRET` (the same value; the migrate task reads it here too); `DRIPSIGN_ANTHROPIC_API_KEY` when `AiEnabled=true` |

ECS injects secrets at task start; replace tasks after a rotation. Each execution role reads only
its own config secret and its database secret. Task roles cannot read Secrets Manager or change
IAM. The references assume the standard Secrets Manager key; a customer-managed key needs an
extension granting `kms:Decrypt`.

## Environment mapping

The task definitions in [stack.yaml](stack.yaml) set what
[`config.ts`](../../packages/core/src/config.ts) parses; [`.env.example`](../../.env.example) lists
every key.

| Variable | Source |
| --- | --- |
| `NODE_ENV`, `DRIPSIGN_PUBLIC_ORIGIN`, `DRIPSIGN_TRUSTED_PROXY_HOPS` | fixed, `https://<Hostname>`, `TrustedProxyHops` (1 behind one ALB) |
| `DRIPSIGN_STORAGE=s3`, `DRIPSIGN_S3_BUCKET`, `AWS_REGION` | the bucket the stack creates, the stack's region |
| `DRIPSIGN_EMAIL_TRANSPORT=ses`, `DRIPSIGN_EMAIL_FROM` | `SesFromAddress` |
| `DRIPSIGN_DATABASE_URL`, `DRIPSIGN_AUTH_SECRET` | the database secret, the config secret key |
| `DRIPSIGN_ANTHROPIC_API_KEY` | config secret key, web and worker, with `AiEnabled` |
| `DRIPSIGN_HOST` | `HostIntegration` (public JSON), web and worker; unset when empty |

`DRIPSIGN_S3_KMS_KEY_ID` is not set; to use a customer-managed key, extend the stack with the
variable and the key grants for both task roles. Other keys keep their defaults.

## Migrate, then start

Run the migrate task before the first start and before a release that changes `schema.sql`:

```sh
aws ecs run-task --cluster <Cluster> --task-definition <MigrateTask> --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<private subnets>],securityGroups=[<MigrateSecurityGroup>],assignPublicIp=DISABLED}"
```

The task runs `cli migrate` as `dripsign_migrator`. It creates the schema in an empty database and
does nothing when the schema is current; a stale schema fails, because the baseline has no
migration chain and needs a rebuilt database. Check its exit code, then raise `WebDesiredCount` and
`WorkerDesiredCount`. Staff are added with the same task and a command override
(`pnpm --filter @dripsign/core cli add-staff --tenant <tenant> --email <email> --role admin`); the
runtime has no other way to add them. The `Outputs` section names the cluster, task and security
group.

## Operate the service

The document bucket blocks public access, requires TLS, encrypts with AES256, and versions every
write; the runtime roles may read and create objects but not delete them. The adapter writes each
object once, and S3 versioning alone does not stop an overwrite. Retain both config secrets and
the bucket on stack deletion or replacement.

Only the worker may send mail, restricted by the verified identity ARN and by `ses:FromAddress`
equal to the configured sender. SES verification, production access, DKIM and delivery evidence
are operator prerequisites. Task egress is limited to TCP 443 and the database port; NAT or
equivalent endpoints must exist. Web readiness is `/api/health`, which answers 200 only
when the database responds and holds the schema this build expects.

Private configuration must not grant this public repository or any fork an AWS OIDC trust
relationship; no public workflow changes ECS, databases, secrets, SES, certificates or DNS.

## Limits and residual risks

- Nothing in this template has been deployed. `cfn-lint` clean proves only schema validity.
- The runtime login holds UPDATE and DELETE on every table; evidence immutability rests on the
  database triggers, which the runtime cannot disable or alter.
- `TrustedProxyHops=1` assumes the ALB is the only proxy; check the recorded address first.

## Reference

The template follows [ECS task definitions](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-taskdefinition.html), [ECS secret injection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html), [SES access control](https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html), and [PostgreSQL default privileges](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html).
