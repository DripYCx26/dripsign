# DripSign database

| Path | Purpose |
| --- | --- |
| `src` | Native sessions, agreement/signing authority, outbox custody and completion export. |
| `migrations` | Timestamped forward SQL applied by `src/migrations.ts` with the migration identity. |
| `migrations/20261009T1200_completion_export.sql` | Forward completion export schema migration. |
| `scripts` | Migration and staff bootstrap entry points. |
| `test/completionExportProof.ts` | Original completion, frozen body and recovery database proof. |

`src/completionExport.ts` freezes the existing completion event only after both
signed-document and audit artifacts are archived. Recovery reuses that event and
its immutable body. `src/jobsStore.ts` rechecks the original native staff session
around public configuration reads and versioned writes. Private Ed25519 seeds
belong to the [jobs service](../../apps/jobs/README.md).
