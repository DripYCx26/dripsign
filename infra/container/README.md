# Container

One image from the repository root: `docker build -f infra/container/Dockerfile .`. It installs
from the frozen pnpm lockfile, builds `@dripsign/web`, and runs on `node:22-slim` as the
unprivileged `node` user with `NODE_ENV=production`.

| File | Purpose |
| --- | --- |
| [Dockerfile](Dockerfile) | Multi-stage build: deps, build, runtime |

The default command is `pnpm --filter @dripsign/web start` (port 3000). The jobs worker uses the
same image with `pnpm --filter @dripsign/core worker`. No credential is accepted at build time;
runtime configuration is the `DRIPSIGN_*` set in [`.env.example`](../../.env.example), and
production requires an https origin with S3 storage and SES email.
