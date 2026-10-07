# Infrastructure

This directory contains generic deployment artifacts. Production resource identifiers, credentials, state, and release authority belong in a private deployment repository.

| Path | Purpose |
| --- | --- |
| [aws](aws/README.md) | Isolated ECS, storage, secrets, network, and database deployment |
| [container](container/README.md) | Shared web and jobs container image |
| [paired-release.md](paired-release.md) | Private paired release and rollback contract |
| [paired-release.schema.json](paired-release.schema.json) | Manifest structure and immutable artifact constraints |
