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
COPY tsconfig.json ./tsconfig.json

# Bypass frozen-lockfile mismatch from Replit-era lockfile
RUN pnpm install --no-frozen-lockfile

RUN pnpm --filter @workspace/api-server build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["pnpm", "--filter", "@workspace/api-server", "start"]
