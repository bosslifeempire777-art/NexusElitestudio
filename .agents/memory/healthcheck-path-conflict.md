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

## The Fix (final, confirmed)
- **pid1 uses FIRST-MATCH routing** (not longest-match). Any service claiming paths=["/"'] with a wildcard rewrite intercepts ALL requests — including /api/* — before more-specific services see them.
- **ai-studio** `artifact.toml`: `paths = []` → completely removed from pid1 routing. Build still runs; Express serves the output.
- **api-server** `artifact.toml`: `paths = ["/"]` → Express is the sole HTTP gateway for everything.

**Why:** Express already handles static serving + SPA fallback + API (from bc852b7's app.ts changes). Making Express the sole gateway eliminates the first-match ambiguity entirely.

**Do NOT** put ai-studio at paths=["/"] with a wildcard rewrite AND api-server at paths=["/api"]. pid1 first-match will intercept /api/* via ai-studio.

## Applied Changes (final)
- `artifacts/ai-studio/.replit-artifact/artifact.toml` — `paths = []` (no routing)
- `artifacts/api-server/.replit-artifact/artifact.toml` — `paths = ["/"]` (sole gateway)
