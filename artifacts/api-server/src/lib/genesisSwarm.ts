/**
 * GENESIS SWARM ARCHITECTURE v1
 * 5-layer production-ready multi-model swarm.
 *
 * Layer 0 → User Input
 * Layer 1 → Concierge Agent   (routes: chat | quick_edit | spawn_swarm)
 * Layer 2 → Orchestration     (Task Decomposer → PLANNER role)
 * Layer 3 → Swarm Execution   (Cost-Efficient | Premium | Guardian sub-agents)
 * Layer 4 → OpenRouter Gateway (verified model IDs + fallback chains)
 *
 * Drop-in replacement for hydraSwarm.ts — all public exports preserved.
 */

import { chatViaSdk } from "./openrouterSdk.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────
// ROLE REGISTRY — verified model IDs only (no fictional IDs)
// ─────────────────────────────────────────────────────────────

interface ModelSpec {
  slug: string;
  contextK?: number;
}

interface RoleConfig {
  primary: ModelSpec;
  fallbacks: ModelSpec[];
  specialty: string;
}

type RoleName =
  | "PLANNER"
  | "BACKEND_CODER"
  | "FRONTEND_CODER"
  | "UI_UX_DESIGNER"
  | "GAME_LOGIC"
  | "REVIEWER"
  | "TROUBLESHOOTER"
  | "ESCALATION"
  | "REPAIR";

export const ROLE_REGISTRY: Record<"cost" | "premium" | "guardian", Partial<Record<RoleName, RoleConfig>>> = {
  cost: {
    PLANNER: {
      primary:   { slug: "deepseek/deepseek-chat", contextK: 64 },
      fallbacks: [{ slug: "openai/gpt-4o-mini" }, { slug: "meta-llama/llama-3.3-70b-instruct:free" }],
      specialty: "software architecture and project decomposition",
    },
    BACKEND_CODER: {
      primary:   { slug: "deepseek/deepseek-chat", contextK: 64 },
      fallbacks: [{ slug: "qwen/qwen3-coder:free" }, { slug: "meta-llama/llama-3.3-70b-instruct:free" }],
      specialty: "backend APIs, databases, authentication, business logic",
    },
    FRONTEND_CODER: {
      primary:   { slug: "deepseek/deepseek-chat", contextK: 64 },
      fallbacks: [{ slug: "qwen/qwen3-coder:free" }, { slug: "meta-llama/llama-3.3-70b-instruct:free" }],
      specialty: "React/Next.js components, state management, routing",
    },
    UI_UX_DESIGNER: {
      primary:   { slug: "google/gemini-2.5-flash", contextK: 128 },
      fallbacks: [{ slug: "deepseek/deepseek-chat" }, { slug: "openai/gpt-4o-mini" }],
      specialty: "UI/UX design, layout, accessibility, responsive design",
    },
    GAME_LOGIC: {
      primary:   { slug: "deepseek/deepseek-chat", contextK: 64 },
      fallbacks: [{ slug: "qwen/qwen3-coder:free" }, { slug: "openai/gpt-4o-mini" }],
      specialty: "game mechanics, physics, AI, gameplay systems",
    },
    REVIEWER: {
      primary:   { slug: "openai/gpt-4o-mini" },
      fallbacks: [{ slug: "deepseek/deepseek-chat" }, { slug: "meta-llama/llama-3.3-70b-instruct:free" }],
      specialty: "code review, security audit, quality assurance",
    },
    TROUBLESHOOTER: {
      primary:   { slug: "openai/gpt-4o-mini" },
      fallbacks: [{ slug: "deepseek/deepseek-chat" }],
      specialty: "debugging, error diagnosis, root cause analysis",
    },
    ESCALATION: {
      primary:   { slug: "anthropic/claude-sonnet-4" },
      fallbacks: [{ slug: "openai/gpt-4o" }],
      specialty: "complex problem escalation and advanced reasoning",
    },
  },
  premium: {
    PLANNER: {
      primary:   { slug: "anthropic/claude-sonnet-4" },
      fallbacks: [{ slug: "openai/gpt-4o" }, { slug: "google/gemini-2.5-pro" }],
      specialty: "enterprise architecture and comprehensive project planning",
    },
    BACKEND_CODER: {
      primary:   { slug: "anthropic/claude-sonnet-4" },
      fallbacks: [{ slug: "openai/gpt-4o" }, { slug: "deepseek/deepseek-chat" }],
      specialty: "production-grade backend, microservices, advanced APIs",
    },
    FRONTEND_CODER: {
      primary:   { slug: "anthropic/claude-sonnet-4" },
      fallbacks: [{ slug: "google/gemini-2.5-pro" }, { slug: "openai/gpt-4o" }],
      specialty: "advanced React, Next.js, performance-optimized frontends",
    },
    UI_UX_DESIGNER: {
      primary:   { slug: "google/gemini-2.5-pro" },
      fallbacks: [{ slug: "anthropic/claude-sonnet-4" }, { slug: "openai/gpt-4o" }],
      specialty: "premium UI/UX, design systems, pixel-perfect interfaces",
    },
    GAME_LOGIC: {
      primary:   { slug: "anthropic/claude-sonnet-4" },
      fallbacks: [{ slug: "openai/gpt-4o" }, { slug: "deepseek/deepseek-chat" }],
      specialty: "advanced game engines, real-time systems, 3D physics",
    },
    REVIEWER: {
      primary:   { slug: "openai/gpt-4o" },
      fallbacks: [{ slug: "anthropic/claude-sonnet-4" }],
      specialty: "deep code review, OWASP security, performance profiling",
    },
    TROUBLESHOOTER: {
      primary:   { slug: "anthropic/claude-sonnet-4" },
      fallbacks: [{ slug: "openai/gpt-4o" }],
      specialty: "complex debugging, architectural problem solving",
    },
    ESCALATION: {
      primary:   { slug: "anthropic/claude-sonnet-4" },
      fallbacks: [{ slug: "openai/gpt-4o" }],
      specialty: "maximum quality final review and polish",
    },
  },
  guardian: {
    REVIEWER: {
      primary:   { slug: "openai/gpt-4o" },
      fallbacks: [{ slug: "anthropic/claude-sonnet-4" }, { slug: "deepseek/deepseek-chat" }],
      specialty: "adversarial code review, bug hunting, security auditing",
    },
    REPAIR: {
      primary:   { slug: "openai/gpt-4o" },
      fallbacks: [{ slug: "anthropic/claude-sonnet-4" }, { slug: "deepseek/deepseek-chat" }],
      specialty: "targeted code repair and issue resolution",
    },
    TROUBLESHOOTER: {
      primary:   { slug: "anthropic/claude-sonnet-4" },
      fallbacks: [{ slug: "openai/gpt-4o" }],
      specialty: "escalated issue troubleshooting",
    },
    ESCALATION: {
      primary:   { slug: "anthropic/claude-sonnet-4" },
      fallbacks: [{ slug: "openai/gpt-4o" }],
      specialty: "guardian escalation and quality assurance",
    },
  },
};

// Concierge uses fast/capable models for routing
const CONCIERGE_MODEL  = "google/gemini-2.5-flash";
const CONCIERGE_FALLBACKS = ["openai/gpt-4o-mini", "deepseek/deepseek-chat"];

// ─────────────────────────────────────────────────────────────
// MODEL_TIERS — backward compat for Command Center / DB config
// ─────────────────────────────────────────────────────────────

export const MODEL_TIERS: Record<string, string[]> = {
  reasoning: [
    "deepseek/deepseek-chat",
    "anthropic/claude-sonnet-4",
    "openai/gpt-4o",
    "google/gemini-2.5-pro",
    "openai/gpt-4o-mini",
    "meta-llama/llama-3.3-70b-instruct:free",
  ],
  coding: [
    "deepseek/deepseek-chat",
    "anthropic/claude-sonnet-4",
    "openai/gpt-4o",
    "qwen/qwen3-coder:free",
    "meta-llama/llama-3.3-70b-instruct:free",
  ],
  fast: [
    "google/gemini-2.5-flash",
    "openai/gpt-4o-mini",
    "deepseek/deepseek-chat",
    "meta-llama/llama-3.3-70b-instruct:free",
  ],
  longctx: [
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash",
    "anthropic/claude-sonnet-4",
    "openai/gpt-4o",
    "deepseek/deepseek-chat",
  ],
  critic: [
    "openai/gpt-4o",
    "anthropic/claude-sonnet-4",
    "deepseek/deepseek-chat",
    "openai/gpt-4o-mini",
    "meta-llama/llama-3.3-70b-instruct:free",
  ],
  creative: [
    "google/gemini-2.5-pro",
    "anthropic/claude-sonnet-4",
    "openai/gpt-4o",
    "google/gemini-2.5-flash",
    "deepseek/deepseek-chat",
  ],
};

// ─────────────────────────────────────────────────────────────
// DB-BACKED TIER CACHE — admin edits invalidated immediately
// ─────────────────────────────────────────────────────────────

let _tierCache: { ts: number; tiers: Record<string, string[]> } | null = null;
const TIER_CACHE_MS = 60_000;

export function invalidateTierCache(): void {
  _tierCache = null;
}

async function getActiveTiers(): Promise<Record<string, string[]>> {
  if (_tierCache && Date.now() - _tierCache.ts < TIER_CACHE_MS) {
    return _tierCache.tiers;
  }
  try {
    const result = await db.execute(sql`SELECT tier, models FROM swarm_tier_config`);
    const tiers: Record<string, string[]> = { ...MODEL_TIERS };
    for (const row of (result as any).rows ?? []) {
      const models = Array.isArray(row.models) ? (row.models as string[]) : [];
      if (models.length > 0) tiers[String(row.tier)] = models;
    }
    _tierCache = { ts: Date.now(), tiers };
    return tiers;
  } catch {
    return MODEL_TIERS;
  }
}

// ─────────────────────────────────────────────────────────────
// SEMAPHORE — cap concurrent API calls
// ─────────────────────────────────────────────────────────────

const MAX_PARALLEL = 20;

class Semaphore {
  private count: number;
  private queue: Array<() => void> = [];
  constructor(count: number) { this.count = count; }
  async acquire(): Promise<void> {
    if (this.count > 0) { this.count--; return; }
    await new Promise<void>(resolve => this.queue.push(resolve));
    this.count--;
  }
  release(): void {
    this.count++;
    const next = this.queue.shift();
    if (next) next();
  }
}

const _semaphore = new Semaphore(MAX_PARALLEL);
const _circuit: Record<string, number> = {};

// ─────────────────────────────────────────────────────────────
// SHARED MEMORY — project-wide blackboard
// ─────────────────────────────────────────────────────────────

export interface ProjectFiles { [path: string]: string; }

export class SharedMemory {
  blueprint: Record<string, any> = {};
  tdd:       Record<string, any> = {};
  files:     ProjectFiles        = {};
  decisions: string[]            = [];
  errors:    string[]            = [];
  metrics    = { calls: 0, tokensIn: 0, tokensOut: 0 };

  writeFile(path: string, content: string): void {
    this.files[path] = content;
  }

  addDecision(d: string): void {
    this.decisions.push(d);
  }

  contextSnippet(): string {
    const keys = Object.keys(this.files).slice(-30);
    return (
      "DECISIONS:\n" + this.decisions.slice(-10).join("\n") +
      `\n\nEXISTING FILES (${Object.keys(this.files).length}): ` + keys.join(", ")
    );
  }
}

// ─────────────────────────────────────────────────────────────
// STRUCTURED EVENT EMITTER — powers the live Genesis diagram
// Emits both a human-readable log line AND a JSON __SWARM__ event
// ─────────────────────────────────────────────────────────────

export type SwarmEvent =
  | { type: "concierge";        model: string; tier: "cost" | "premium" }
  | { type: "orchestrate";      tasks: number; model: string }
  | { type: "agent_start";      role: string; model: string; task: string; swarm: "cost" | "premium" | "guardian" }
  | { type: "agent_done";       role: string; model: string; swarm: "cost" | "premium" | "guardian" }
  | { type: "guardian_start";   tier: "cost" | "premium" | "guardian"; artifacts: number }
  | { type: "guardian_repair";  path: string; attempt: number }
  | { type: "guardian_done";    passed: number; repaired: number; escalated: number }
  | { type: "gateway";          model: string; calls: number }
  | { type: "progress";         pct: number }
  | { type: "build_complete";   files: number; calls: number };

function swarmLog(
  onLog: (msg: string) => void,
  humanText: string,
  event: SwarmEvent,
): void {
  onLog(humanText);
  onLog(`__SWARM__:${JSON.stringify(event)}`);
}

// ─────────────────────────────────────────────────────────────
// LLM CALL — fallback chain + circuit breaker
// ─────────────────────────────────────────────────────────────

function timeoutForModel(model: string): number {
  if (/opus|sonnet|gemini-2\.5-pro/i.test(model)) return 120_000;
  if (model.endsWith(":free"))                       return  60_000;
  return 60_000;
}

export async function callLlm(
  prompt:      string,
  system       = "You are an elite production-grade engineer.",
  tier         = "coding",
  maxTokens    = 8000,
  temperature  = 0.3,
  jsonMode     = false,
  agentName    = "anon",
  mem?:        SharedMemory,
  onLog?:      (msg: string) => void,
): Promise<string> {
  const _tiers = await getActiveTiers();
  const chain  = _tiers[tier] ?? _tiers.coding ?? MODEL_TIERS.coding;
  return _callChain(chain, prompt, system, maxTokens, temperature, jsonMode, agentName, mem, onLog);
}

export async function callByRole(
  prompt:      string,
  system:      string,
  role:        RoleName,
  swarmTier:   "cost" | "premium" | "guardian" = "cost",
  maxTokens    = 8000,
  temperature  = 0.3,
  jsonMode     = false,
  agentName    = "anon",
  mem?:        SharedMemory,
  onLog?:      (msg: string) => void,
): Promise<{ text: string; modelUsed: string }> {
  const roleConf = ROLE_REGISTRY[swarmTier]?.[role] ?? ROLE_REGISTRY.cost.BACKEND_CODER!;
  const chain    = [roleConf.primary.slug, ...roleConf.fallbacks.map(f => f.slug)];
  const text     = await _callChain(chain, prompt, system, maxTokens, temperature, jsonMode, agentName, mem, onLog);
  return { text, modelUsed: chain[0] };
}

async function _callChain(
  chain:       string[],
  prompt:      string,
  system:      string,
  maxTokens:   number,
  temperature: number,
  jsonMode:    boolean,
  agentName:   string,
  mem?:        SharedMemory,
  onLog?:      (msg: string) => void,
): Promise<string> {
  let lastErr: any = null;

  await _semaphore.acquire();
  try {
    for (const model of chain) {
      if ((_circuit[model] ?? 0) > Date.now()) continue;
      try {
        const body: Record<string, any> = {
          model,
          messages: [
            { role: "system", content: system },
            { role: "user",   content: prompt  },
          ],
          max_tokens:  maxTokens,
          temperature,
        };
        if (jsonMode) body.response_format = { type: "json_object" };

        const data    = await chatViaSdk(body, { timeoutMs: timeoutForModel(model) });
        const content = data.choices?.[0]?.message?.content ?? "";

        if (!content) {
          _circuit[model] = Date.now() + 15_000;
          continue;
        }

        if (mem) {
          mem.metrics.calls++;
          mem.metrics.tokensIn  += data.usage?.prompt_tokens     ?? 0;
          mem.metrics.tokensOut += data.usage?.completion_tokens ?? 0;
        }

        onLog?.(`  ✓ [${agentName}] ${model} (${content.length} chars)`);
        return content;
      } catch (err: any) {
        lastErr = err;
        const status: number | undefined = err?.statusCode ?? err?.status ?? err?.response?.status;
        const isTimeout  = err?.name === "AbortError" || /timeout/i.test(err?.message ?? "");
        const retryable  = isTimeout || status === 429 || (status !== undefined && status >= 500);
        _circuit[model]  = Date.now() + (status === 429 ? 30_000 : 15_000);
        if (!retryable && status !== undefined) continue;
        continue;
      }
    }
  } finally {
    _semaphore.release();
  }

  throw lastErr ?? new Error(`All models failed`);
}

// ─────────────────────────────────────────────────────────────
// UTILITY HELPERS — unchanged from hydraSwarm
// ─────────────────────────────────────────────────────────────

export function extractJson(text: string): any {
  let t = text.trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) t = m[1].trim();
  const candidates = [t.indexOf("{"), t.indexOf("[")].filter(i => i >= 0);
  const start = candidates.length ? Math.min(...candidates) : 0;
  t = t.slice(start);
  for (let end = t.length; end > 0; end--) {
    try { return JSON.parse(t.slice(0, end)); } catch {}
  }
  return {};
}

export function extractCodeFiles(text: string): ProjectFiles {
  const files: ProjectFiles = {};
  const pattern = /===\s*FILE:\s*(.+?)\s*===\s*```[\w+\-]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const path = m[1].trim().replace(/^\//, "");
    files[path] = m[2].trimEnd() + "\n";
  }
  return files;
}

// ─────────────────────────────────────────────────────────────
// AGENT BASE CLASS — maps to Genesis roles
// ─────────────────────────────────────────────────────────────

export interface AgentResult {
  name:   string;
  output: string;
  files:  ProjectFiles;
  meta:   Record<string, any>;
}

export class HydraAgent {
  constructor(
    public name:        string,
    public role:        string,
    public tier        = "coding",
    public temperature = 0.3,
    public maxTokens   = 8000,
  ) {}

  async run(
    task:    string,
    context  = "",
    mem?:    SharedMemory,
    onLog?:  (msg: string) => void,
  ): Promise<AgentResult> {
    const system = (
      `You are ${this.name}, a ${this.role}. ` +
      "Respond in production-quality, fully implemented code with NO placeholders. " +
      "When emitting files, format as:\n" +
      "===FILE: relative/path.ext===\n```lang\n<code>\n```\n"
    );
    const out = await callLlm(
      `PROJECT CONTEXT:\n${context}\n\nTASK:\n${task}`,
      system, this.tier, this.maxTokens, this.temperature, false, this.name, mem, onLog,
    );
    return { name: this.name, output: out, files: extractCodeFiles(out), meta: {} };
  }
}

// ─────────────────────────────────────────────────────────────
// LAYER 1 — CONCIERGE (routes: chat | quick_edit | spawn_swarm)
// ─────────────────────────────────────────────────────────────

async function runConcierge(
  userPrompt: string,
  mem:        SharedMemory,
  onLog:      (msg: string) => void,
): Promise<{ tier: "cost" | "premium"; spec: string }> {
  swarmLog(onLog,
    `🎩 [Concierge] Analysing project request...`,
    { type: "concierge", model: CONCIERGE_MODEL, tier: "cost" },
  );

  const system = `You are the Genesis Swarm Concierge. Classify the request and choose a build tier.
Return ONLY JSON: {"tier":"cost"|"premium","spec":"detailed build specification starting from the user prompt","action":"spawn_swarm"}
Use "premium" only when the user says "best quality", "no compromises", or it's a mission-critical system.`;

  const chain = [CONCIERGE_MODEL, ...CONCIERGE_FALLBACKS];
  let raw = "";
  try {
    raw = await _callChain(chain, userPrompt, system, 2000, 0.3, true, "Concierge", mem, onLog);
  } catch {
    raw = `{"tier":"cost","spec":"${userPrompt.replace(/"/g, "'")}","action":"spawn_swarm"}`;
  }

  const parsed = extractJson(raw);
  const tier   = parsed?.tier === "premium" ? "premium" : "cost";
  const spec   = parsed?.spec || userPrompt;

  swarmLog(onLog,
    `🎩 [Concierge] Routing to ${tier.toUpperCase()} swarm`,
    { type: "concierge", model: CONCIERGE_MODEL, tier },
  );

  return { tier, spec };
}

// ─────────────────────────────────────────────────────────────
// LAYER 2 — ORCHESTRATION (Sovereign blueprint + Architect council)
// ─────────────────────────────────────────────────────────────

async function runOrchestration(
  spec:      string,
  swarmTier: "cost" | "premium",
  mem:       SharedMemory,
  onLog:     (msg: string) => void,
): Promise<{ blueprint: Record<string, any>; tdd: Record<string, any>; departments: string[] }> {
  const plannerRole = ROLE_REGISTRY[swarmTier]?.PLANNER ?? ROLE_REGISTRY.cost.PLANNER!;
  const plannerModel = plannerRole.primary.slug;

  swarmLog(onLog,
    `\n👑 [Orchestrator / PLANNER] Generating project blueprint...`,
    { type: "agent_start", role: "PLANNER", model: plannerModel, task: "Project blueprint analysis", swarm: swarmTier },
  );

  const system = (
    "You are the Genesis Swarm Planner. Read the request and output a JSON blueprint with: " +
    "project_name, project_type (mobile_app|saas|website|business_software|video_game|hybrid), " +
    "platforms[], stack{}, key_features[], target_users, complexity (1-10), estimated_files, risks[]."
  );
  const raw = await callByRole(spec, system, "PLANNER", swarmTier, 4000, 0.4, true, "PLANNER", mem, onLog);
  const blueprint = extractJson(raw.text);
  mem.blueprint = blueprint;
  mem.addDecision(`Project type: ${blueprint.project_type}, stack: ${JSON.stringify(blueprint.stack)}`);

  swarmLog(onLog,
    `👑 [Orchestrator / PLANNER] Blueprint: ${blueprint.project_name} (${blueprint.project_type})`,
    { type: "agent_done", role: "PLANNER", model: raw.modelUsed, swarm: swarmTier },
  );

  // Architect council — 5 specialists in parallel
  const ARCHITECTS = [
    ["SystemArchitect",   "system architect designing modules, services, and data flow"],
    ["UXArchitect",       "UX/UI architect designing screens, flows, components"],
    ["DataArchitect",     "data architect designing schemas, indexes, migrations"],
    ["SecurityArchitect", "security architect designing auth, RBAC, threat model"],
    ["DevOpsArchitect",   "devops architect designing CI/CD, infra, deploy"],
  ] as const;

  const ctx = JSON.stringify(blueprint, null, 2);

  const archResults = await Promise.allSettled(
    ARCHITECTS.map(([name, role]) => {
      swarmLog(onLog,
        `🏛 [Architect Council / ${name}] Designing ${name.replace("Architect", "")} layer...`,
        { type: "agent_start", role: "PLANNER", model: plannerModel, task: `${name} design`, swarm: swarmTier },
      );
      const a = new HydraAgent(name, role, swarmTier === "premium" ? "reasoning" : "reasoning", 0.3, 6000);
      return a.run(
        `Produce your section of the Technical Design Document for this blueprint. Output JSON with key '${name}_design'.`,
        ctx, mem, onLog,
      );
    })
  );

  const tdd: Record<string, any> = {};
  for (const r of archResults) {
    if (r.status === "fulfilled") {
      const merged = extractJson(r.value.output);
      if (merged && typeof merged === "object") Object.assign(tdd, merged);
    }
  }
  mem.tdd = tdd;

  swarmLog(onLog,
    `🏛 [Architect Council] Technical Design Document complete`,
    { type: "agent_done", role: "PLANNER", model: plannerModel, swarm: swarmTier },
  );

  const departments = selectDepartments(blueprint);
  const taskCount = departments.length * 8; // estimated

  swarmLog(onLog,
    `📋 [Orchestrator] Decomposed into ~${taskCount} tasks across ${departments.length} departments: ${departments.join(", ")}`,
    { type: "orchestrate", tasks: taskCount, model: plannerModel },
  );

  onLog(`__SWARM__:${JSON.stringify({ type: "progress", pct: 15 })}`);

  return { blueprint, tdd, departments };
}

// Department selection (unchanged logic from hydraSwarm)
const DEPARTMENTS: Record<string, string> = {
  Frontend:      "frontend lead (React/Next.js/Vue/Svelte web UIs)",
  Backend:       "backend lead (Node/Python/Go APIs, microservices)",
  Database:      "database lead (Postgres, schemas, queries, ORM)",
  MobileIOS:     "iOS lead (Swift/SwiftUI or React Native)",
  MobileAndroid: "Android lead (Kotlin/Jetpack or React Native)",
  GameEngine:    "game dev lead (Unity C#, Godot, Phaser, Three.js)",
  AIML:          "AI/ML lead (LLM integration, embeddings, RAG)",
  Auth:          "authentication lead (OAuth, JWT, sessions, RBAC)",
  Payments:      "payments lead (Stripe, IAP, subscriptions)",
  DevOps:        "devops lead (Docker, CI, deploy scripts, EAS)",
  QA:            "QA lead (unit, integration, e2e tests)",
  Docs:          "documentation lead (README, API docs, user guides)",
};

function selectDepartments(blueprint: Record<string, any>): string[] {
  const pt   = (blueprint.project_type ?? "").toLowerCase();
  const base = ["Backend", "Database", "Auth", "DevOps", "QA", "Docs"];
  if (pt.includes("mobile"))   base.push("MobileIOS", "MobileAndroid", "Frontend");
  if (pt.includes("saas"))     base.push("Frontend", "Payments", "AIML");
  if (pt.includes("website"))  base.push("Frontend");
  if (pt.includes("business")) base.push("Frontend", "Auth", "Payments");
  if (pt.includes("game"))     return ["GameEngine", "Backend", "DevOps", "QA", "Docs"];
  if (pt.includes("hybrid"))   base.push(...Object.keys(DEPARTMENTS));
  return [...new Set(base)];
}

// ─────────────────────────────────────────────────────────────
// LAYER 3 — SWARM EXECUTION (department heads + workers)
// ─────────────────────────────────────────────────────────────

interface AtomicTask {
  id:          string;
  title:       string;
  file_hint:   string;
  description: string;
  depends_on?: string[];
}

// Maps department names to Genesis roles
function deptToRole(dept: string): RoleName {
  if (dept === "GameEngine")                    return "GAME_LOGIC";
  if (dept === "Frontend" || dept === "MobileIOS" || dept === "MobileAndroid") return "FRONTEND_CODER";
  if (dept === "AIML")                          return "PLANNER";
  if (dept === "QA")                            return "REVIEWER";
  if (["Backend", "Database", "Auth", "Payments", "DevOps"].includes(dept)) return "BACKEND_CODER";
  return "BACKEND_CODER";
}

async function departmentHeadDecompose(
  dept:      string,
  ctx:       string,
  swarmTier: "cost" | "premium",
  mem:       SharedMemory,
  onLog:     (msg: string) => void,
): Promise<AtomicTask[]> {
  const role   = DEPARTMENTS[dept];
  const system = (
    `You are the ${dept} Department Head (${role}). ` +
    "Decompose your domain into 5-15 ATOMIC implementation tasks. " +
    "Each task = one file or one tightly-scoped unit. " +
    `Output JSON: {"tasks":[{"id":"...","title":"...","file_hint":"path","description":"...","depends_on":[]}]}`
  );
  const genesisRole = deptToRole(dept);
  const roleConf = ROLE_REGISTRY[swarmTier]?.[genesisRole] ?? ROLE_REGISTRY.cost.BACKEND_CODER!;

  const raw = await _callChain(
    [roleConf.primary.slug, ...roleConf.fallbacks.map(f => f.slug)],
    ctx, system, 4000, 0.3, true, `${dept}-Head`, mem, onLog,
  );
  const data = extractJson(raw);
  return Array.isArray(data?.tasks) ? data.tasks : [];
}

async function workerExecute(
  task:      AtomicTask,
  dept:      string,
  ctx:       string,
  swarmTier: "cost" | "premium",
  mem:       SharedMemory,
  onLog:     (msg: string) => void,
): Promise<AgentResult> {
  const genesisRole  = deptToRole(dept);
  const roleConf     = ROLE_REGISTRY[swarmTier]?.[genesisRole] ?? ROLE_REGISTRY.cost.BACKEND_CODER!;
  const primaryModel = roleConf.primary.slug;
  const workerName   = `${dept}-${genesisRole}`;

  swarmLog(onLog,
    `  ⚙️ [${workerName}] ${task.title}`,
    { type: "agent_start", role: genesisRole, model: primaryModel, task: task.title.slice(0, 60), swarm: swarmTier },
  );

  const system = (
    `You are an elite ${dept} engineer (Genesis role: ${genesisRole}). ` +
    "Produce PRODUCTION-READY, fully-typed, complete code. No placeholders, no TODOs. " +
    "When emitting files: ===FILE: relative/path.ext===\n```lang\n<code>\n```"
  );
  const prompt = (
    `Task: ${task.title}\nFile: ${task.file_hint}\nDescription: ${task.description}\n\n` +
    `PROJECT CONTEXT:\n${ctx.slice(0, 4000)}\n\n` +
    `EXISTING FILES:\n${mem.contextSnippet().slice(0, 2000)}`
  );

  const chain = [primaryModel, ...roleConf.fallbacks.map(f => f.slug)];
  const out   = await _callChain(chain, prompt, system, 8000, 0.2, false, workerName, mem, onLog);

  swarmLog(onLog,
    `  ✅ [${workerName}] ${task.title} complete`,
    { type: "agent_done", role: genesisRole, model: primaryModel, swarm: swarmTier },
  );

  return { name: workerName, output: out, files: extractCodeFiles(out), meta: {} };
}

// ─────────────────────────────────────────────────────────────
// LAYER 3b — GUARDIAN SWARM (self-healing quality assurance)
// ─────────────────────────────────────────────────────────────

async function runGuardianPass(
  mem:       SharedMemory,
  swarmTier: "cost" | "premium",
  onLog:     (msg: string) => void,
  passNum    = 1,
): Promise<{ passed: number; repaired: number; escalated: number }> {
  const fileEntries = Object.entries(mem.files);
  if (fileEntries.length === 0) return { passed: 0, repaired: 0, escalated: 0 };

  const reviewerRole  = ROLE_REGISTRY.guardian?.REVIEWER ?? ROLE_REGISTRY.cost.REVIEWER!;
  const repairRole    = ROLE_REGISTRY.guardian?.REPAIR   ?? ROLE_REGISTRY.cost.ESCALATION!;
  const reviewerModel = reviewerRole.primary.slug;

  swarmLog(onLog,
    `\n🛡 [Guardian Swarm] Pass ${passNum}: reviewing ${fileEntries.length} files...`,
    { type: "guardian_start", tier: "guardian", artifacts: fileEntries.length },
  );

  let passed = 0;
  let repaired = 0;
  let escalated = 0;

  const CRITICS = [
    ["BugHunter",       "ruthless bug hunter: undefined refs, logic errors, runtime crashes"],
    ["SecurityAuditor", "security auditor: injection, XSS, auth flaws, secret leaks"],
    ["UXCritic",        "UX expert: accessibility, usability, responsiveness"],
  ] as const;

  const reviewChain    = [reviewerRole.primary.slug, ...reviewerRole.fallbacks.map(f => f.slug)];
  const repairChain    = [repairRole.primary.slug,   ...repairRole.fallbacks.map(f => f.slug)];

  for (const [filePath, code] of fileEntries) {
    const sysBase  = `Review code. JSON: {"verdict":"pass"|"fix","severity":"low"|"med"|"high","issues":[]}`;
    const ctx      = `FILE: ${filePath}\n\n${code.slice(0, 6000)}`;

    const outs = await Promise.allSettled(
      CRITICS.map(([n, r]) =>
        _callChain(reviewChain, ctx, `You are ${n}, a ${r}. ${sysBase}`, 1500, 0.2, true, n, mem)
      )
    );

    const issues: string[] = [];
    let needsFix = false;
    for (const o of outs) {
      if (o.status !== "fulfilled") continue;
      const d = extractJson(o.value);
      if (Array.isArray(d?.issues)) issues.push(...(d.issues as string[]));
      if (d?.verdict === "fix" && ["med", "high"].includes(d?.severity)) needsFix = true;
    }

    if (!needsFix || issues.length === 0) {
      passed++;
    } else {
      swarmLog(onLog,
        `  🔧 [Guardian] Repairing ${filePath} (${issues.length} issues)`,
        { type: "guardian_repair", path: filePath, attempt: passNum },
      );

      try {
        const fixSystem = `Rewrite the file fixing every issue. Emit a single ===FILE: ${filePath}=== block.`;
        const fixPrompt = `ORIGINAL:\n${code}\n\nISSUES:\n- ${issues.join("\n- ")}`;
        const fixed     = await _callChain(repairChain, fixPrompt, fixSystem, 8000, 0.2, false, `Guardian:${filePath}`, mem);
        const newCode   = extractCodeFiles(fixed)[filePath] ?? code;
        mem.writeFile(filePath, newCode);
        repaired++;
      } catch {
        escalated++;
      }
    }
  }

  swarmLog(onLog,
    `🛡 [Guardian Swarm] Pass ${passNum} complete — ✅ ${passed} passed, 🔧 ${repaired} repaired, ⬆ ${escalated} escalated`,
    { type: "guardian_done", passed, repaired, escalated },
  );

  return { passed, repaired, escalated };
}

// ─────────────────────────────────────────────────────────────
// LAYER 4 — PACKAGER + FINAL ASSEMBLY
// ─────────────────────────────────────────────────────────────

function packageProject(mem: SharedMemory, onLog: (msg: string) => void): ProjectFiles {
  const output: ProjectFiles = { ...mem.files };

  if (!output["README.md"]) {
    output["README.md"] = (
      `# ${mem.blueprint.project_name ?? "Project"}\n\n` +
      `Type: ${mem.blueprint.project_type}\n\n` +
      "Generated by Genesis Swarm Architecture.\n\n" +
      "## Features\n- " + (mem.blueprint.key_features ?? []).join("\n- ") + "\n"
    );
  }

  if (!output[".env.example"]) {
    output[".env.example"] = "OPENROUTER_API_KEY=\nDATABASE_URL=\nJWT_SECRET=\n";
  }

  output["BUILD_REPORT.json"] = JSON.stringify({
    generator:  "Genesis Swarm v1",
    blueprint:  mem.blueprint,
    files:      Object.keys(mem.files),
    metrics:    mem.metrics,
    decisions:  mem.decisions,
  }, null, 2);

  onLog(`\n📦 [Packager] Assembled ${Object.keys(output).length} files`);
  return output;
}

// ─────────────────────────────────────────────────────────────
// ORCHESTRATOR — MAIN ENTRY POINT (replaces old buildProject)
// ─────────────────────────────────────────────────────────────

export interface HydraBuildResult {
  files:     ProjectFiles;
  blueprint: Record<string, any>;
  metrics:   SharedMemory["metrics"];
  decisions: string[];
  errors:    string[];
}

export async function buildProject(
  userPrompt: string,
  onLog:      (msg: string) => void = console.log,
): Promise<HydraBuildResult> {
  const mem = new SharedMemory();

  onLog("━".repeat(58));
  onLog("⚡ GENESIS SWARM v1 — engaging 5-layer architecture");
  onLog("━".repeat(58));

  // ── Layer 1: Concierge routing ──
  const { tier, spec } = await runConcierge(userPrompt, mem, onLog);
  onLog(`__SWARM__:${JSON.stringify({ type: "progress", pct: 5 })}`);

  // ── Layer 2: Orchestration ──
  const { blueprint, tdd, departments } = await runOrchestration(spec, tier, mem, onLog);
  onLog(`__SWARM__:${JSON.stringify({ type: "progress", pct: 20 })}`);

  const ctx = JSON.stringify({ blueprint, tdd }, null, 2).slice(0, 12_000);

  // ── Layer 3: Department head decomposition ──
  onLog(`\n🏢 [Swarm Manager] Launching ${departments.length} department heads...`);
  const decomps  = await Promise.all(
    departments.map(d => departmentHeadDecompose(d, ctx, tier, mem, onLog))
  );
  const deptWork = departments.map((d, i) => ({ dept: d, tasks: decomps[i] }));
  const total    = deptWork.reduce((s, dw) => s + dw.tasks.length, 0);
  onLog(`📋 [Swarm Manager] ${total} atomic tasks across ${departments.length} departments`);
  onLog(`__SWARM__:${JSON.stringify({ type: "progress", pct: 30 })}`);

  // ── Layer 3: Worker execution (capped by semaphore) ──
  const coros: Promise<AgentResult>[] = [];
  for (const { dept, tasks } of deptWork) {
    for (const t of tasks) {
      coros.push(workerExecute(t, dept, ctx, tier, mem, onLog));
    }
  }
  onLog(`\n⚙️  [Swarm Manager] Spawning ${coros.length} workers (${MAX_PARALLEL} concurrent max)...`);

  const results = await Promise.allSettled(coros);
  let doneCount = 0;
  for (const r of results) {
    if (r.status === "rejected") { mem.errors.push(String(r.reason)); continue; }
    for (const [p, c] of Object.entries(r.value.files)) mem.writeFile(p, c);
    doneCount++;
    if (doneCount % 5 === 0) {
      const pct = 30 + Math.round((doneCount / coros.length) * 40);
      onLog(`__SWARM__:${JSON.stringify({ type: "progress", pct })}`);
    }
  }
  onLog(`__SWARM__:${JSON.stringify({ type: "progress", pct: 70 })}`);

  // ── Layer 3b: Guardian pass 1 ──
  await runGuardianPass(mem, tier, onLog, 1);
  onLog(`__SWARM__:${JSON.stringify({ type: "progress", pct: 85 })}`);

  // Premium gets a second guardian pass
  if (tier === "premium") {
    await runGuardianPass(mem, tier, onLog, 2);
    onLog(`__SWARM__:${JSON.stringify({ type: "progress", pct: 93 })}`);
  }

  // ── Layer 4: Final packaging ──
  const files = packageProject(mem, onLog);
  onLog(`__SWARM__:${JSON.stringify({ type: "progress", pct: 100 })}`);

  onLog("\n" + "━".repeat(58));
  onLog(
    `✅ GENESIS SWARM COMPLETE — ${mem.metrics.calls} LLM calls, ` +
    `${mem.metrics.tokensIn + mem.metrics.tokensOut} tokens, ${Object.keys(files).length} files`
  );
  onLog("━".repeat(58));

  onLog(`__SWARM__:${JSON.stringify({
    type: "build_complete",
    files: Object.keys(files).length,
    calls: mem.metrics.calls,
  })}`);

  return {
    files,
    blueprint: mem.blueprint,
    metrics:   mem.metrics,
    decisions: mem.decisions,
    errors:    mem.errors,
  };
}

// ─────────────────────────────────────────────────────────────
// LEGACY EXPORTS — keep hydraSwarm callers working
// ─────────────────────────────────────────────────────────────

export const sovereign = async (
  userPrompt: string,
  mem:        SharedMemory,
  onLog:      (msg: string) => void,
) => runOrchestration(userPrompt, "cost", mem, onLog).then(r => r.blueprint);

export const criticReview = async (
  filePath: string,
  code:     string,
  mem:      SharedMemory,
  onLog:    (msg: string) => void,
): Promise<{ verdict: "pass" | "fix"; issues: string[] }> => {
  const reviewerRole = ROLE_REGISTRY.guardian?.REVIEWER ?? ROLE_REGISTRY.cost.REVIEWER!;
  const chain = [reviewerRole.primary.slug, ...reviewerRole.fallbacks.map(f => f.slug)];
  const ctx   = `FILE: ${filePath}\n\n${code.slice(0, 6000)}`;
  const sysBase = `Review code. JSON: {"verdict":"pass"|"fix","severity":"low"|"med"|"high","issues":[]}`;

  const CRITICS = [["BugHunter", "bug hunter"], ["SecurityAuditor", "security auditor"]] as const;
  const outs = await Promise.allSettled(
    CRITICS.map(([n, r]) => _callChain(chain, ctx, `You are ${n}, a ${r}. ${sysBase}`, 1500, 0.2, true, n, mem))
  );

  const issues: string[] = [];
  let verdict: "pass" | "fix" = "pass";
  for (const o of outs) {
    if (o.status !== "fulfilled") continue;
    const d = extractJson(o.value);
    if (Array.isArray(d?.issues)) issues.push(...(d.issues as string[]));
    if (d?.verdict === "fix" && ["med", "high"].includes(d?.severity)) verdict = "fix";
  }
  return { verdict, issues };
};
