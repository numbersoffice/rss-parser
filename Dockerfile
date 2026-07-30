# syntax=docker/dockerfile:1

# Alpine is safe here: better-sqlite3 v13 ships its native binding as bundled
# N-API prebuilds (including linuxmusl-x64/arm64) and has no install script, so
# there is nothing to compile and no build toolchain to install.
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN node_modules/.bin/tsc

FROM ${NODE_IMAGE} AS prod-deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    # 50 feeds × 12 items is a few MB of live data; the cap stops V8 lazily
    # growing its heap just because the host has plenty of RAM.
    NODE_OPTIONS=--max-old-space-size=192 \
    DATA_DIR=/app/data \
    ACCOUNTS_FILE=/app/accounts.txt \
    PORT=3000
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
COPY package.json accounts.txt ./

# Fail the build, not the first request, if the musl prebuild didn't resolve.
RUN node -e "const D=require('better-sqlite3'); new D(':memory:').close(); console.log('sqlite ok')"

RUN mkdir -p /app/data/assets /app/data/tmp && chown -R node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/server.js"]
