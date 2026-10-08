# Infrastructure

This directory contains generic deployment artifacts. Production resource identifiers, credentials, state, and release authority belong in a private deployment repository.

| Path | Purpose |
| --- | --- |
| [aws](aws/README.md) | Isolated ECS, storage, secrets, network, and database deployment |
| [azure](azure/README.md) | Isolated Container Apps, Blob, Key Vault, Communication Services, Front Door, and PostgreSQL deployment |
| [database.sql](database.sql) | Administrator bootstrap for an isolated database and restricted runtime role, shared by both templates |
| [container](container/README.md) | Shared web and jobs container image |
| [paired-release.md](paired-release.md) | Private paired release and rollback contract |
| [paired-release.schema.json](paired-release.schema.json) | Manifest structure and immutable artifact constraints |
