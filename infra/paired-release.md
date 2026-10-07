# Private paired releases

Production deployment is owned by a private deployment repository. Public CI builds generic DripSign artifacts and records their immutable digests. It has no production cloud credentials, AWS role trust, V2 checkout, V2 image access, or private workflow. This contract replaces independent uncoordinated releases of the shared staff interface and its API; it does not create a second signing backend.

## Manifest

The private operator stores an immutable manifest matching [paired-release.schema.json](paired-release.schema.json), reviews it, and records its SHA-256 digest with deployment outcomes. Repository commits identify source; OCI `@sha256:` digests identify running bytes. Tag names and `latest` are not release identity. Copy a public image to private ECR without changing its contents, and record the source and destination digests if the registry rewrites the manifest.

The manifest names the DripSign web/jobs image, immutable shared UI package version and integrity hash, DripSign API version, the API versions accepted by the new V2 consumer, the previous V2 consumer's accepted API versions, the V2 image digest, and the schema interval supported by both the new and rollback DripSign images. Private resource references and secrets remain outside the manifest. The schema accepts no secret or arbitrary extra fields.

## Deploy order

1. Lock the environment to one private release operation. Record the current manifest, task definitions, task counts, DB schema version, active webhook destination, and queue state. Verify the candidate image includes the exact UI package represented in the V2 image and both V2 versions accept the candidate DripSign API.
2. Back up the DripSign database and archive configuration. Apply only additive, compatible migrations using the private owner-capable connection URL and `dripsign_owner` effective role. Finalize runtime ledger privileges as described in [migration identity and ledger](aws/README.md#migration-identity-and-ledger) before starting either runtime. The resulting schema must be in the intersection of the candidate and rollback DripSign schema intervals. Stop if it is outside that interval.
3. Deploy DripSign web with jobs paused. Confirm `/health`, API compatibility, staff bridge authorization, recipient scope, and artifact access. Only after readiness, deploy jobs at the recorded image digest and prove reconciliation can resume existing jobs without duplicating sends, submissions, paid calls, or executed events.
4. Deploy V2 at its manifest digest with the exact UI dependency. Confirm `/sign` calls the DripSign API through the server bridge. A failed V2 deployment leaves the previous compatible V2 consumer serving against DripSign.
5. Switch the authenticated DocuSeal webhook to the sole DripSign owner when changing ownership. Confirm queued events and callbacks reconcile, then permit explicit staff publication and invitations. Record both service outcomes against the manifest digest.

The pair is not atomic. At every step, the previous V2 consumer must work with the candidate API; the previous DripSign image must work with the migrated schema and the newly deployed V2 consumer. Unsupported combinations block deployment. Compatibility is a declared contract to exercise privately, not proof inferred from matching version strings.

## Rollback and uncertainty

Set `DRIPSIGN_ADMISSION_PAUSED=1` on web and replace the normal jobs tasks with `DRIPSIGN_RECOVERY_ONLY=1` tasks before rollback. Wait for normal jobs tasks to drain or stop under their existing leases. Recovery-only tasks claim only signing reconciliation and archival; they do not send invitations or codes, create signing submissions, call AI, or deliver integration events. Preserve leases and ambiguous provider outcomes. Keep the same authoritative DripSign database, artifact bucket, grants, issued revision identities, submission references, and append-only events. Never restore a pre-release database snapshot over new writes or reactivate a V2 signing writer.

Restore V2 first to its previous digest, then DripSign web/jobs to the recorded rollback digest if both compatibility intervals still hold. Retain additive migrations. Run recovery-only jobs until every known ambiguous signing round has a confirmed state or a visible hold. Check provider, archive, and event ledgers before restarting normal jobs tasks. Clear `DRIPSIGN_ADMISSION_PAUSED` only after the compatible web, normal jobs, and host bridge are healthy. If new data or a breaking migration prevents rollback, keep dispatch paused and roll forward with compatible code. Do not automatically retry uncertain email, provider creation, cancellation, or paid AI requests.

If only DripSign succeeded, keep compatible old V2 and retry the V2 deployment or roll DripSign back. If V2 succeeded but DripSign is unhealthy, pause staff mutations and restore V2 first. A valid manifest records rollback image, UI integrity/version, API version, schema bounds, and previous V2 digest; operators recover using those bytes rather than rebuilding old source.

## Authority boundary

The private workflow alone receives narrowly scoped deployment authority and environment approval. It supplies ECR digests, CloudFormation parameters, secrets, and migration identity, waits for service health, and writes the private release record. Public pull requests and package publishing cannot trigger it or obtain its credentials. Public publishing permissions are limited to this repository's artifacts as described by [GitHub package publishing](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions).
