---
name: Concierge model config
description: How the concierge agent model is selected — DB is source of truth, not frontend or module-level defaults
---

# Concierge Model Selection

## The rule
`swarm_role_config WHERE tier='concierge' AND role='main'` is the source of truth.
Query it **fresh in projects.ts** at every concierge chat request.

## Why this matters
`loadLiveRegistry()` in genesisSwarm.ts is only called inside `runGenesisSwarm()` (swarm path).
Concierge chats go through a separate code path that never calls it.
Module-level `_conciergeModel` stays at its startup default forever for concierge requests.

## How to apply
In `projects.ts`, before calling `runConciergeAgent`, do:
```sql
SELECT primary_slug, fallbacks, tools FROM swarm_role_config
WHERE tier = 'concierge' AND role = 'main' LIMIT 1
```
Pass `primary_slug` as `model` and the full `[primary_slug, ...fallbacks]` as `fallbackChain`.
DB wins; `req.body.conciergeModel` from the frontend is last-resort only.

## Frontend default
`localStorage.getItem("nexus-concierge-model") ?? ""` — must be empty string, NOT a hardcoded model slug.
Any hardcoded slug there will override Command Center settings for users who never explicitly picked a model.

## Concierge fallback chain (in conciergeAgent.ts)
`CONCIERGE_DEFAULT_CHAIN` is only used when there is NO DB config AND no model passed in.
Default is `["google/gemini-2.5-flash", "deepseek/deepseek-v4-flash", "meta-llama/llama-3.3-70b-instruct:free"]`.
