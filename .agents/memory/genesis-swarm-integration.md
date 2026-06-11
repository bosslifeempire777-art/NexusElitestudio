---
name: Genesis Swarm full integration status
description: What's implemented vs the design doc; what was intentionally skipped
---

## Fully integrated (genesisSwarm.ts)
- 5-layer architecture: Concierge → Orchestration → Swarm Execution → Guardian → Packager
- ROLE_REGISTRY cost/premium/guardian with verified OpenRouter model IDs
- loadLiveRegistry() — DB-backed live model overrides via swarm_role_config table
- Concierge routing (cost vs premium tier)
- Architect Council: 5 parallel design specialists in runOrchestration
- Department head decomposition: 5-15 atomic tasks per dept
- Worker execution with Semaphore(20) concurrency cap
- Dependency-ordered wave execution: tasks wait for depends_on to complete
  Deadlock guard: if no tasks ready, runs all remaining
- Per-model retry: MAX_RETRIES_PER_MODEL=3, 500ms→8s exponential backoff+jitter
- OpenRouter provider hints: `provider: { allow_fallbacks: true }` on every call
- Guardian Swarm: 3-critic review (BugHunter, SecurityAuditor, UXCritic) + auto-repair
- Premium gets 2 guardian passes
- packageProject: README.md, .env.example, BUILD_REPORT.json output
- NEXUS_PLATFORM_SPEC: window.NEXUS_API GET/POST/PUT/DELETE contract injected into ctx
- QUALITY_STANDARDS: SOLID, OWASP, WCAG, no-TODOs rules in every worker system prompt
- sanitizePrompt(): code-fence/script/handler injection prevention on user input
- Circuit breaker: _circuit[model] tracks until-time, per-model cooldown

## Intentionally skipped (not worth the complexity for MVP)
- SelfImprovement engine (telemetry + model scoring suggestions)
- MetricsCollector with USD cost tracking (token count is tracked)
- TenantManager (single-tenant system)
- Pino logger (console logging sufficient at current scale)
- Redis/queue-based task distribution (in-memory works fine)

**Why:** These were architectural suggestions in the design doc, not requirements. 
The implemented system is production-ready without them.

## Self-Improvement Engine
- Class: SelfImprovementEngine, singleton exported as `selfImprovement` from genesisSwarm.ts
- Telemetry via optional `telemetryCtx?: { role, tier }` on `_callChain`
- callByRole passes telemetryCtx automatically — no changes needed at call sites
- API: GET /admin/command-center/self-improvement/insights|suggest/:tier

## OpenRouter SDK — complete API surface
- chatViaSdk: non-streaming, with AbortController timeout (existing)
- listModels(): fetches /api/v1/models, 5-min cache
- getCredits(): fetches /api/v1/auth/key
- chatStreamViaSdk(): async generator, SSE stream via raw fetch
- API: GET /admin/command-center/or-models|or-credits

## Agent config bug — root cause documented
Architect Council was bypassing role registry (swarm_role_config) because
HydraAgent.run() → callLlm() → getActiveTiers() reads swarm_tier_config (old system).
Fix: Architect Council now calls callByRole("PLANNER") directly.
Rule: Never use HydraAgent inside the Genesis swarm — it ignores _activeRegistry.
