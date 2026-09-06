FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.base.json ./
COPY lib ./lib
COPY artifacts ./artifacts
COPY scripts ./scripts
COPY attached_assets ./attached_assets

RUN pnpm install --no-frozen-lockfile

# Build frontend (do not set PORT here — vite.config validates PORT for dev server)
RUN NODE_ENV=production pnpm --filter @workspace/ai-studio build \
 && test -f artifacts/ai-studio/dist/public/index.html \
 && echo "Frontend build OK" \
 && ls -la artifacts/ai-studio/dist/public | head -15

RUN NODE_ENV=production pnpm --filter @workspace/api-server build \
 && test -f artifacts/api-server/dist/index.cjs \
 && echo "API build OK"

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

WORKDIR /app
CMD ["node", "artifacts/api-server/dist/index.cjs"]
