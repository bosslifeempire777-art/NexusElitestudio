FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY lib ./lib
COPY artifacts ./artifacts
COPY scripts ./scripts
COPY attached_assets ./attached_assets
COPY tsconfig.json ./tsconfig.json

# Bypass frozen-lockfile mismatch from Replit-era lockfile
RUN pnpm install --no-frozen-lockfile

# Build frontend (output → artifacts/ai-studio/dist/public)
# then API (serves that folder in production)
ENV NODE_ENV=production
RUN pnpm --filter @workspace/ai-studio build \
 && pnpm --filter @workspace/api-server build

ENV PORT=8080
EXPOSE 8080

CMD ["pnpm", "--filter", "@workspace/api-server", "start"]
