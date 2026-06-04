---
name: Vercel deployment integration
description: How Vercel replaces Render for dedicated deployment hosting
---

## Architecture
- `artifacts/api-server/src/lib/vercel.ts` — all Vercel API calls
- Vercel API v13: `POST /v13/deployments` with `{ name, files: [{ file: "index.html", data: html }] }`
- Deployment is a **static** HTML file; buttons call back to the NexusElite platform API via `window.NEXUS_API`
- CORS wildcard on the platform allows cross-origin fetch from any `*.vercel.app` domain

## Key flow
1. Provision: fetch project.generatedCode → `injectNexusApi(html, nexusApiUrl, projectId)` → POST to Vercel → store `deploymentId` as `providerServiceId`, `provider = "vercel"`
2. Re-deploy: create new Vercel deployment with fresh HTML; update `providerServiceId` to new deployment ID
3. Status: `GET /v13/deployments/{id}` → `readyState` in {INITIALIZING, BUILDING, QUEUED, READY, ERROR, CANCELED}
4. Poller: `render-poller.ts` handles both `provider=vercel` and `provider=render` in the same loop

## Required secret
`VERCEL_TOKEN` — personal or team token from Vercel dashboard.
Optional: `VERCEL_TEAM_ID` — if token belongs to a team scope.

## Backward compat
Existing `provider=render` deployments still sync/redeploy via Render. Only new provisions use Vercel.
