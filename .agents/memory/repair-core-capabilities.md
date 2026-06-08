---
name: Nexus Repair Core capabilities
description: What the admin repair agent can and cannot access, and what was added.
---

## Current capabilities (as of June 2026)

### Modes
- **Platform Code** — reads up to 60 source files (80KB each) from `artifacts/api-server/src`, `artifacts/ai-studio/src`, `lib/db/src`, `*/.replit-artifact`, writes patches, runs safe SQL DDL, auto-restarts
- **Project App** — reads/patches a single generated app's HTML by project ID
- **Shell** — runs real shell commands with 2min timeout (no sudo)
- **Logs** — fetches in-process console log buffer (up to 300 entries), sends to AI for diagnosis with optional code fixes

### Conversation history
Every repair/logs mode exchange accumulates a `repairHistory` array in the frontend.  
Up to 12 prior turns are sent with each request so the AI has full session context.  
Clearing the terminal also resets history.  A "N turns remembered" badge shows depth.

### Log capture
`artifacts/api-server/src/lib/log-buffer.ts` intercepts `console.log/warn/error/info` into a ring buffer (800 entries max).  
Imported in `index.ts` as first side-effect import.  
Exposed at `GET /api/admin/logs?n=300&level=error|warn`.

### Crash fix
`uncaughtException` handler in `index.ts` now swallows transient Postgres errors  
(`terminating connection due to administrator command`, `Authentication timed out`, codes 57P01/08P01)  
instead of crashing the server and triggering a crash loop.

**Why:** Replit managed DB periodically recycles connections; before this fix each recycle  
would crash the process and potentially prevent deployment promotion.
