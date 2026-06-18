---
name: Token usage tracking pattern
description: How token/billing data flows from LLM calls through to recordUsage; also covers rebuild project-memory injection.
---

## The pattern

`CallOpts` has an optional `usageAcc?: { tokensIn: number; tokensOut: number; model: string }`.
Pass an object by reference; `callLLM` increments it after every successful response.
`hydraSwarm` accepts the same object and appends from `mem.metrics` at the end.
This means no return-type changes were needed — pure side-effect accumulation.

**Why:** Changing return types of `generateProjectCode`/`generateChatResponse` would break the
`streamBuild(() => generateProjectCode(...))` lambda pattern. Side-effect accumulator avoids that entirely.

## Four billing paths in projects.ts

| Route | Accumulator | recordUsage kind |
|---|---|---|
| POST /projects (initial build) | `buildUsageAcc` → `generateProjectCode` | `"build"` |
| POST /projects/:id/rebuild | `rebuildUsageAcc` → `generateProjectCode` | `"rebuild"` |
| POST /projects/:id/chat, !hasCode | `chatUsageAcc` → `generateChatResponse` | `"chat_only"` |
| POST /projects/:id/chat, hasCode | `chatUsageAcc` merged from concierge + swarm paths | `"chat_change"` |

For the chat `hasCode` path there are 3 sub-paths; each merges into `chatUsageAcc`:
- Direct swarm: `swarmUsageAcc` merged in after generation
- Concierge (no escalation): `conciergeResult.tokensIn/Out` merged inside the `else` block
- Concierge + escalated swarm: `escalatedSwarmAcc + conciergeResult` merged when swarm succeeds

**Critical scoping rule:** `conciergeResult` is scoped to the inner concierge `else` block.
Merge its tokens THERE, not in the outer `if (changed)` block (causes TS2304).

## Rebuild project memory injection

`generateProjectCode` now accepts `memory?: ProjectMemory | null`.
Rebuild route loads it with: `const pMemory = (project.memory as ProjectMemory | null) ?? null;`
The memory section is injected into the swarm prompt (and game/single-shot prompts) so the AI
receives its full history — summary, completedTasks, decisions — and preserves them on rebuild.

## How to apply

Any new LLM-using route that should appear in billing:
1. Create `const myAcc = { tokensIn: 0, tokensOut: 0, model: "" };`
2. Pass it as `usageAcc` to `generateProjectCode` / `generateChatResponse` / `callLLM`
3. Call `recordUsage({ ..., tokensIn: myAcc.tokensIn, tokensOut: myAcc.tokensOut, model: myAcc.model || undefined })`
