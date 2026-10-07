# Workflows

| File | Purpose |
| --- | --- |
| [artifacts.yml](artifacts.yml) | Build generic image on pull requests; publish the main commit image to this repository's GHCR package |

The build job has repository read permission. The publishing job receives only repository read and package write permission, consumes the already built image, and runs only for `main`. Actions are pinned to immutable commits. Image builds receive no secrets. This directory contains no AWS federation, deployment environment, private V2 checkout, or production release workflow. Actual production rollout belongs to the private [paired release contract](../../infra/paired-release.md).
