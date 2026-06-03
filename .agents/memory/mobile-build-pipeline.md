---
name: Mobile Build Pipeline
description: EAS Build integration for generating and publishing React Native / Expo mobile apps from mobile_app projects
---

# Mobile Build Pipeline

## Accounts
- Expo account: `Nexuselitestudio` (owner slug used in all EAS API calls)
- GitHub account: `bosslifeempire777-art` (repos pushed here for EAS to build from)
- EXPO_TOKEN: stored as Replit secret (user's Nexuselitestudio access token)

## Key Files
- `artifacts/api-server/src/lib/eas.ts` — GitHub push + EAS trigger + status polling
- `artifacts/api-server/src/lib/generateMobileCode.ts` — AI Expo project generator (outputs multi-file JSON)
- Routes added to `artifacts/api-server/src/routes/projects.ts`:
  - POST `/:id/mobile-build` — Pro/Elite/Admin/VIP only
  - GET  `/:id/mobile-build/:buildId` — poll status
  - GET  `/:id/mobile-download` — Expo ZIP for paid plans

## Critical: callLLM must be exported
`callLLM` in `openrouter.ts` was originally unexported (`async function`).
It was exported (`export async function`) to allow `generateMobileCode.ts` to import it.
**Why:** generateMobileCode.ts needs direct LLM access without going through the swarm pipeline.
**How to apply:** If you add any new lib that needs direct LLM calls, import `callLLM` from `openrouter.js`.

## Plan Gating
- Mobile build (EAS trigger): Pro ($60), Elite ($269), Admin, VIP
- Mobile ZIP download: any paid plan (Starter+), Admin, VIP

## Frontend
- "Publish App" violet button appears only on `project.type === 'mobile_app'` projects
- Opens a modal: platform picker (Android APK / iOS IPA), build status polling, download link
- State/callbacks in `project-detail.tsx`: `triggerMobileBuild`, `downloadMobileZip`, `mobilePollRef`

## EAS Build Flow
1. AI generates Expo Router project files (multi-file JSON from `generateMobileCode`)
2. `eas.ts` pushes files to GitHub repo `nexus-mobile-{projectId}` via Replit GitHub connector
3. EAS project ensured at `nexus-{projectId}` slug
4. EAS build triggered via `POST /v2/builds` with platform + buildProfile: "preview"
5. Frontend polls `GET /v2/builds/{buildId}` every 15s until finished/errored
6. `artifactUrl` returned as APK/IPA download link when done

## Notes
- Android APK builds take ~10–20 min in EAS cloud
- iOS builds require Apple Developer account (not yet set up)
- Generated repos are private on GitHub
- NEXUS_API is passed into the generated `constants/api.ts` at build time so the app has real backend connectivity
