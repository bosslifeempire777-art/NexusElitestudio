---
name: Production healthcheck path conflict
description: Root cause and fix for Replit autoscale healthcheck returning 500 despite app starting correctly
---

## The Problem
Two artifacts both declared `paths = ["/"]` in their `[[services]]` config:
- `artifacts/ai-studio`: `localPort = 22936`, `paths = ["/"]`, production had `build` but NO `run` and NO `publicDir`
- `artifacts/api-server`: `localPort = 8080`, `paths = ["/"]`, has production `run`

Replit's pid1 sidecar registers BOTH services for `/`. It routes healthcheck probes to the **first matching service** — ai-studio on port 22936 — where nothing listens in production. Result: every GET / and GET /api/healthz probe returns 500. Express never sees the request (confirmed by zero app-level logs in production despite port 8080 being bound).

## Why It's Hard to Spot
- `app.listen()` succeeds (pid1 logs "artifact port detected port=8080") — app IS running
- No app logs appear — because pid1 routes probes away before they reach Express
- App works perfectly locally (no pid1 routing layer in local test)
- Successful build (Jun 4) had different artifact config — only api-server claimed "/"

## The Fix
1. **ai-studio** `artifact.toml`: added `publicDir = "artifacts/ai-studio/dist/public"` to `[services.production]` → pid1 serves it as a static site
2. **api-server** `artifact.toml`: changed `paths = ["/"]` → `paths = ["/api"]` → zero overlap, healthcheck at `/api/healthz` unambiguously routes to Express

**Why:** `publicDir` tells pid1 the static serving root; changing api-server paths to `/api` eliminates the conflict entirely. The healthcheck path `/api/healthz` now routes unambiguously to port 8080.

## Applied Changes
- `artifacts/ai-studio/.replit-artifact/artifact.toml` — `[services.production]` gets `publicDir`
- `artifacts/api-server/.replit-artifact/artifact.toml` — `paths = ["/api"]`
