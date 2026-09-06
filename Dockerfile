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

# Build frontend then API
ENV NODE_ENV=production
RUN pnpm --filter @workspace/ai-studio build \
 && pnpm --filter @workspace/api-server build \
 && test -f artifacts/ai-studio/dist/public/index.html \
 && echo "Frontend build OK" \
 && ls -la artifacts/ai-studio/dist/public | head -20

ENV PORT=8080
EXPOSE 8080

# Must run from workspace root so staticDir resolves to artifacts/ai-studio/dist/public
WORKDIR /app
CMD ["node", "artifacts/api-server/dist/index.cjs"]
