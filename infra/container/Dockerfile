FROM node:22-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global --ignore-scripts pnpm@10.34.6
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json ./packages/core/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages ./packages
COPY apps ./apps
COPY tsconfig.base.json ./
RUN pnpm --filter @dripsign/web build

FROM node:22-slim
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /usr/local/lib/node_modules/pnpm /usr/local/lib/node_modules/pnpm
RUN ln -s ../lib/node_modules/pnpm/bin/pnpm.cjs /usr/local/bin/pnpm
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
# The worker uses this same image with: pnpm --filter @dripsign/core worker
CMD ["pnpm", "--filter", "@dripsign/web", "start"]
