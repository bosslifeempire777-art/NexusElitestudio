---
name: NEXUS_API URL construction
description: Why x-forwarded-host must NOT be used; use getBaseUrl() / REPLIT_DOMAINS instead
---

## Rule
In `projects.ts`, never construct `window.NEXUS_API` from `req.get("x-forwarded-host")`. Always use `getBaseUrl()`.

## Why
Replit's proxy does **not** forward the `x-forwarded-host` header. The fallback chain falls to `req.get("host")` which resolves to `localhost:8080` inside the container. Any iframe (live preview) receiving `window.NEXUS_API = "https://localhost:8080/..."` cannot reach that host from the user's browser — all button clicks silently fail.

## How to apply
`getBaseUrl()` (defined in projects.ts ~line 103) uses `CUSTOM_DOMAIN || REPLIT_DOMAINS?.split(",")[0] || REPLIT_DEV_DOMAIN`, which always resolves to the correct public-facing domain in both dev and prod.

Same pattern exists as `getPublicBaseUrl()` in deployments.ts — these two functions are equivalent.

Four call sites in projects.ts were fixed: preview route, mobile build, mobile download zip, OTA update.
