# ── Build stage ────────────────────────────────────────────────────────
# Compiles the TanStack Start app to .output/. Peak RAM is ~1.5 GB, so on
# a 1–2 GB VPS build this image in CI and pull it instead (see README,
# "Prebuilt image").
FROM node:24-bookworm AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# ── Runtime stage ──────────────────────────────────────────────────────
# .output bundles everything (only runtime dep is tslib), so the runtime
# image is just Node + the built server.
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
COPY --from=build /app/.output ./
EXPOSE 3000
USER node
CMD ["node", "server/index.mjs"]
