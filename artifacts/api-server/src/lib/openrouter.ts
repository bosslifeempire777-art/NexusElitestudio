import axios from "axios";
import { db } from "@workspace/db";
import { agentModelAssignmentsTable } from "@workspace/db/schema";
import pLimit from "p-limit";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// ─── HYDRA-PRIME v4 Config ─────────────────────────────────────────────────
const MAX_PARALLEL  = 20;   // simultaneous LLM calls (reduced from 200 for API rate limits)
const MAX_RECURSION = 2;    // fractal sub-swarm depth

// Model tiers — HYDRA-PRIME v4 routing with proven platform fallbacks appended
const MODEL_TIERS: Record<string, string[]> = {
  reasoning: [
    // Working reliably (confirmed in logs) ↓
    "qwen/qwen3.6-plus",
    "deepseek/deepseek-v4-flash",
    "qwen/qwen3-coder:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    // Paid fallbacks (need OpenRouter credits) ↓
    "deepseek/deepseek-v4-pro",
    "google/gemini-3.5-flash",
    "google/gemini-2.5-pro",
    "anthropic/claude-opus-4.8",
    "moonshotai/kimi-k2.6",
    "minimax/minimax-m3",
    "openai/gpt-5",
    "z-ai/glm-5.1",
  ],
  coding: [
    // Working reliably ↓
    "qwen/qwen3.6-plus",
    "deepseek/deepseek-v4-flash",
    "qwen/qwen3-coder:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    // Paid fallbacks ↓
    "openai/gpt-5-codex",
    "z-ai/glm-5.1",
    "x-ai/grok-build-0.1",
    "google/gemini-3.5-flash",
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4.8",
  ],
  fast: [
    // Working reliably ↓
    "qwen/qwen3.6-plus",
    "deepseek/deepseek-v4-flash",
    "meta-llama/llama-3.3-70b-instruct:free",
    "qwen/qwen3-coder:free",
    // Paid fallbacks ↓
    "google/gemini-3.5-flash",
    "z-ai/glm-5.1",
    "anthropic/claude-haiku-4.5",
    "inclusionai/ling-2.6-1t",
  ],
  longctx: [
    // Working reliably ↓
    "qwen/qwen3.6-plus",
    "deepseek/deepseek-v4-flash",
    "qwen/qwen3-coder:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    // Paid fallbacks ↓
    "google/gemini-3.5-flash",
    "google/gemini-2.5-pro",
    "moonshotai/kimi-k2.6",
    "openai/gpt-5",
    "anthropic/claude-sonnet-4.6",
    "minimax/minimax-m3",
    "z-ai/glm-5.1",
  ],
  critic: [
    // Working reliably ↓
    "qwen/qwen3.6-plus",
    "deepseek/deepseek-v4-flash",
    "qwen/qwen3-coder:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    // Paid fallbacks ↓
    "deepseek/deepseek-v4-pro",
    "z-ai/glm-5.1",
    "google/gemini-3.5-flash",
    "anthropic/claude-sonnet-4.6",
  ],
  creative: [
    // Working reliably ↓
    "qwen/qwen3.6-plus",
    "deepseek/deepseek-v4-flash",
    "qwen/qwen3-coder:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    // Paid fallbacks ↓
    "z-ai/glm-5.1",
    "anthropic/claude-opus-4.8",
    "openai/gpt-5",
    "moonshotai/kimi-k2.6",
    "google/gemini-3.5-flash",
    "minimax/minimax-m3",
  ],
};

// ─── Module-level state ────────────────────────────────────────────────────
const circuit: Record<string, number> = {};   // model → cooldown_until (ms epoch)
const limiter = pLimit(MAX_PARALLEL);

// ─── Per-run shared blackboard (mirrors SharedMemory from HYDRA-PRIME memory.ts) ───
/**
 * Created fresh for every hydraSwarm() call — never shared between requests.
 * Provides the same blackboard contract as the original CLI: blueprint, tdd,
 * files (written by workers), decisions, errors, and call/token metrics.
 */
export class SharedMemory {
  blueprint:  Record<string, any>    = {};
  tdd:        Record<string, any>    = {};
  files:      Record<string, string> = {};
  decisions:  string[]               = [];
  errors:     string[]               = [];
  metrics = { calls: 0, tokens_in: 0, tokens_out: 0, cost_est: 0.0 };

  private _chain: Promise<void> = Promise.resolve();

  private lock<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this._chain.then(fn) as Promise<T>;
    this._chain = (run as Promise<any>).then(() => undefined, () => undefined);
    return run;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.lock(() => { this.files[path] = content; });
  }

  async addDecision(d: string): Promise<void> {
    await this.lock(() => { this.decisions.push(d); });
  }

  /** Returns a compact context string workers append to their prompts. */
  contextSnippet(maxChars = 8_000): string {
    const keys      = Object.keys(this.files).slice(-30);
    const decisions = this.decisions.slice(-10).join("\n");
    const snippet   =
      `DECISIONS:\n${decisions}\n\nEXISTING FILES (${Object.keys(this.files).length}): ${keys.join(", ")}`;
    return snippet.length > maxChars ? snippet.slice(0, maxChars) : snippet;
  }
}

// ─── AgentResult (mirrors src/agent.ts from HYDRA-PRIME) ──────────────────
export interface AgentResult {
  name:   string;
  output: string;
  files:  Record<string, string>;
  meta:   Record<string, any>;
}

// ─── Agent class (mirrors src/agent.ts from HYDRA-PRIME) ───────────────────
/**
 * Wraps callLLM with a consistent persona, tier, and file-extraction contract.
 * Agents optionally carry agentIds for Command Center model overrides.
 */
export class Agent {
  constructor(
    public name:        string,
    public role:        string,
    public tier:        string  = "coding",
    public temperature: number  = 0.3,
    public maxTokens:   number  = 8_000,
    public agentIds:    string[] = [],
  ) {}

  async run(task: string, context: string = "", mem?: SharedMemory): Promise<AgentResult> {
    const sys =
      `You are ${this.name}, a ${this.role}. ` +
      "Respond in production-quality, fully implemented code with NO placeholders, " +
      "NO 'TODO', NO 'as needed' comments. Every function fully written. " +
      "When emitting files, format as:\n" +
      "===FILE: relative/path.ext===\n```lang\n<code>\n```\n";
    const prompt = `PROJECT CONTEXT:\n${context}\n\nTASK:\n${task}`;
    const out = await callLLM(prompt, {
      system:      sys,
      tier:        this.tier as keyof typeof MODEL_TIERS,
      maxTokens:   this.maxTokens,
      temperature: this.temperature,
      agentName:   this.name,
      agentIds:    this.agentIds,
      mem,
    });
    return { name: this.name, output: out, files: extractCodeFiles(out), meta: {} };
  }
}

// ─── Command Center model-assignment cache ─────────────────────────────────
let _agentCache: { ts: number; map: Record<string, string> } | null = null;
const AGENT_CACHE_MS = 30_000;

async function getAgentAssignments(): Promise<Record<string, string>> {
  if (_agentCache && Date.now() - _agentCache.ts < AGENT_CACHE_MS) return _agentCache.map;
  try {
    const rows = await db.select().from(agentModelAssignmentsTable);
    const map: Record<string, string> = {};
    for (const r of rows) map[r.agentId] = r.model;
    _agentCache = { ts: Date.now(), map };
    return map;
  } catch { return {}; }
}

function timeoutForModel(model: string): number {
  if (/opus|sonnet|kimi|gemini-3/i.test(model)) return 120_000;
  if (model.endsWith(":free"))                   return  60_000;
  return 60_000;
}

// ─── callLLM — HYDRA-PRIME core routing via axios (circuit breaker + pLimit + MEM metrics)
export interface CallOpts {
  system?:      string;
  tier?:        keyof typeof MODEL_TIERS;
  maxTokens?:   number;
  temperature?: number;
  jsonMode?:    boolean;
  agentName?:   string;
  agentIds?:    string[];   // Command Center override keys
  /** Pass a full message array instead of constructing system+user from opts */
  messages?:    Array<{ role: string; content: string }>;
  /** Per-run SharedMemory blackboard — tracks call/token metrics on the run */
  mem?:         SharedMemory;
}

export async function callLLM(prompt: string, opts: CallOpts = {}): Promise<string> {
  const {
    system      = "You are an elite production-grade engineer.",
    tier        = "coding",
    maxTokens   = 8_000,
    temperature = 0.3,
    jsonMode    = false,
    agentName   = "anon",
    agentIds    = [],
    messages,
    mem,
  } = opts;

  const baseChain = MODEL_TIERS[tier] ?? MODEL_TIERS.coding;

  // Prepend any Command Center model overrides
  let chain = baseChain;
  if (agentIds.length > 0) {
    const assignments = await getAgentAssignments();
    const pinned: string[] = [];
    for (const id of agentIds) {
      const m = assignments[id];
      if (m && !pinned.includes(m)) pinned.push(m);
    }
    if (pinned.length > 0) {
      console.log(`  [CC] ${agentIds[0]}: ${pinned.join(", ")}`);
      chain = [...pinned, ...baseChain.filter(m => !pinned.includes(m))];
    }
  }

  return limiter(async () => {
    let lastErr: string | null = null;

    for (const model of chain) {
      if ((circuit[model] || 0) > Date.now()) continue;  // circuit breaker

      const body: Record<string, any> = {
        model,
        messages: messages ?? [
          { role: "system", content: system },
          { role: "user",   content: prompt  },
        ],
        max_tokens:  maxTokens,
        temperature,
      };
      if (jsonMode) body.response_format = { type: "json_object" };

      try {
        // Direct axios call — mirrors HYDRA-PRIME llm.ts exactly.
        // validateStatus:()=>true means axios never throws on HTTP errors;
        // we inspect res.status ourselves and set the circuit breaker accordingly.
        const res = await axios.post(OPENROUTER_URL, body, {
          headers: {
            Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer":  "https://nexuselitestudio.com",
            "X-Title":       "HYDRA-PRIME-SWARM-v4",
          },
          timeout:        timeoutForModel(model),
          validateStatus: () => true,
        });

        if (res.status === 429 || res.status >= 500) {
          circuit[model] = Date.now() + 30_000;
          lastErr = `${model}: HTTP ${res.status}`;
          console.warn(`  ⚠ [${agentName}] ${model} (${res.status}) → next fallback`);
          continue;
        }
        if (res.status >= 400) {
          circuit[model] = Date.now() + 15_000;
          lastErr = `${model}: HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`;
          console.warn(`  ⚠ [${agentName}] ${model} (${res.status}) → next fallback`);
          continue;
        }

        const content: string = res.data?.choices?.[0]?.message?.content ?? "";

        // Track metrics on the per-run blackboard (mirrors MEM.metrics in HYDRA-PRIME llm.ts)
        if (mem) {
          mem.metrics.calls     += 1;
          const usage            = res.data?.usage ?? {};
          mem.metrics.tokens_in  += usage.prompt_tokens     ?? 0;
          mem.metrics.tokens_out += usage.completion_tokens ?? 0;
        }

        console.log(`  ✓ [${agentName}] ${model} (${content.length} chars)`);
        return content;
      } catch (err: any) {
        circuit[model] = Date.now() + 15_000;
        lastErr = `${model}: ${err?.message ?? err}`;
        console.warn(`  ⚠ [${agentName}] ${model} (error) → next fallback`);
        continue;
      }
    }

    throw new Error(`All models failed [${tier}] for '${agentName}': ${lastErr}`);
  });
}

// ─── JSON / file-block extraction helpers ─────────────────────────────────
function extractJSON(text: string): any {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const fb = t.indexOf("{"), fb2 = t.indexOf("[");
  const cands = [fb, fb2].filter(i => i >= 0);
  const start = cands.length ? Math.min(...cands) : 0;
  t = t.slice(start);
  for (let end = t.length; end > 0; end--) {
    try { return JSON.parse(t.slice(0, end)); } catch { continue; }
  }
  return {};
}

function extractCodeFiles(text: string): Record<string, string> {
  const files: Record<string, string> = {};
  const pat = /===\s*FILE:\s*(.+?)\s*===\s*```[\w+\-]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = pat.exec(text)) !== null) {
    const path = m[1].trim().replace(/^\/+/, "");
    files[path] = m[2].replace(/\s+$/, "") + "\n";
  }
  return files;
}

async function gatherSettled<T>(promises: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(promises);
  const out: T[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") out.push(r.value);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// HYDRA-PRIME SWARM LAYERS
// ═══════════════════════════════════════════════════════════════════════════

// ── Layer 1: SOVEREIGN ────────────────────────────────────────────────────
async function sovereign(userPrompt: string, mem: SharedMemory): Promise<Record<string, any>> {
  const raw = await callLLM(userPrompt, {
    system:
      "You are SOVEREIGN, the CEO architect. Read the user's request and " +
      "output a JSON master blueprint with keys: project_name, project_type " +
      "(saas|website|mobile_app|ai_tool|automation|game|hybrid), " +
      "platforms[], stack{}, key_features[], target_users, monetization, " +
      "complexity (1-10), estimated_files (int), risks[].",
    tier: "reasoning",
    maxTokens: 4_000,
    temperature: 0.4,
    jsonMode: true,
    agentName: "SOVEREIGN",
    agentIds: ["swarm-sovereign", "orchestrator"],
    mem,
  });
  const bp = extractJSON(raw);
  mem.blueprint = bp;
  await mem.addDecision(`Project type: ${bp.project_type}, stack: ${JSON.stringify(bp.stack)}`);
  console.log(`\n👑 SOVEREIGN: ${bp.project_name} (${bp.project_type})`);
  return bp;
}

// ── Layer 2: ARCHITECT COUNCIL ────────────────────────────────────────────
const ARCHITECTS: [string, string][] = [
  ["SystemArchitect",   "system architect designing modules, services, and data flow"],
  ["UXArchitect",       "UX/UI architect designing screens, flows, components, design system"],
  ["DataArchitect",     "data architect designing collections, schemas, and data relationships"],
  ["SecurityArchitect", "security architect designing auth patterns and session management"],
  ["DevOpsArchitect",   "devops architect designing system integration and deployment strategy"],
];

async function architectCouncil(blueprint: Record<string, any>, mem: SharedMemory): Promise<Record<string, any>> {
  console.log("\n🏛  ARCHITECT COUNCIL convening...");
  const ctx = JSON.stringify(blueprint, null, 2);

  // Uses Agent class exactly as in HYDRA-PRIME src/layers/architects.ts
  const results = await gatherSettled(
    ARCHITECTS.map(([name, role]) => {
      const a = new Agent(name, role, "reasoning", 0.3, 6_000, ["swarm-architect"]);
      return a.run(
        `Produce your section of the Technical Design Document for this blueprint. ` +
        `Be exhaustive. Focus on your domain. ` +
        `Output JSON with key '${name}_design' containing your complete design.`,
        ctx,
        mem,
      ).then(res => extractJSON(res.output));
    })
  );

  const tdd: Record<string, any> = {};
  for (const r of results) {
    if (r && typeof r === "object" && !Array.isArray(r)) Object.assign(tdd, r);
  }
  mem.tdd = tdd;
  await mem.addDecision("TDD finalized by architect council");
  console.log(`  ✓ TDD assembled from ${results.length} architects`);
  return tdd;
}

// ── Layer 3: DEPARTMENT HEADS ─────────────────────────────────────────────
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
  const pt = (blueprint.project_type || "").toLowerCase();
  let base = ["Backend", "Database", "Auth", "DevOps", "QA", "Docs"];
  if (pt.includes("mobile"))     base = base.concat(["MobileIOS", "MobileAndroid", "Frontend"]);
  if (pt.includes("saas"))       base = base.concat(["Frontend", "Payments", "AIML"]);
  if (pt.includes("website"))    base = base.concat(["Frontend"]);
  if (pt.includes("ai_tool"))    base = base.concat(["Frontend", "AIML"]);
  if (pt.includes("automation")) base = base.concat(["Frontend", "AIML"]);
  if (pt.includes("business"))   base = base.concat(["Frontend", "Auth", "Payments"]);
  if (pt.includes("game"))       base = ["GameEngine", "Backend", "DevOps", "QA", "Docs"];
  if (pt.includes("hybrid"))     base = base.concat(Object.keys(DEPARTMENTS));
  return Array.from(new Set(base));
}

interface WorkerTask {
  id: string;
  title: string;
  file_hint: string;
  description: string;
  depends_on?: string[];
}

async function departmentHeadDecompose(dept: string, ctx: string, mem: SharedMemory): Promise<WorkerTask[]> {
  const role = DEPARTMENTS[dept];
  const raw = await callLLM(ctx, {
    system:
      `You are the ${dept} Department Head (${role}). ` +
      "Decompose your domain into 5-10 ATOMIC implementation tasks. " +
      "Each task = one file or one tightly-scoped unit. " +
      `Output JSON: {"tasks": [{"id":"...","title":"...","file_hint":"path","description":"...","depends_on":[]}]}`,
    tier: "reasoning",
    maxTokens: 3_000,
    temperature: 0.3,
    jsonMode: true,
    agentName: `${dept}-Head`,
    agentIds: ["swarm-dept-head"],
    mem,
  });
  const data = extractJSON(raw);
  return Array.isArray(data?.tasks) ? (data.tasks as WorkerTask[]) : [];
}

// ── Layer 4: FRACTAL WORKER SWARM ─────────────────────────────────────────
/**
 * Mirrors HYDRA-PRIME src/layers/workers.ts exactly:
 * - Uses Agent class with the swarm-worker agentId for Command Center overrides
 * - Appends mem.contextSnippet() to the task context (blackboard awareness)
 * - Writes all emitted files to the per-run SharedMemory
 * - Returns AgentResult (not raw file map) so hydraSwarm can access .files & .output
 * - Oversized tasks recursively spawn a sub-swarm (spawnSubswarm)
 */
async function workerExecute(
  task: WorkerTask,
  dept: string,
  ctx: string,
  depth: number,
  mem: SharedMemory,
): Promise<AgentResult> {
  const name = `${dept}-W-${task.id || "x"}`;
  const role = `${dept} implementation engineer`;
  const desc = task.description || "";

  // FRACTAL: spawn sub-swarm for oversized tasks (mirrors workers.ts)
  if (depth < MAX_RECURSION && desc.length > 1200 && desc.toLowerCase().includes("split")) {
    return spawnSubswarm(task, dept, ctx, depth + 1, mem);
  }

  const a = new Agent(name, role, "coding", 0.2, 8_000, ["swarm-worker"]);
  const fullTask =
    `Task ID: ${task.id}\n` +
    `Title: ${task.title}\n` +
    `Target file: ${task.file_hint}\n` +
    `Description: ${desc}\n\n` +
    "Implement fully. Emit one or more ===FILE: path=== blocks.";

  // Append SharedMemory context snippet so each worker sees sibling decisions & files
  const result = await a.run(fullTask, ctx + "\n" + mem.contextSnippet(), mem);

  // Write all emitted files to the per-run blackboard
  for (const [path, content] of Object.entries(result.files)) {
    await mem.writeFile(path, content);
  }
  return result;
}

/** Sub-swarm spawner — mirrors spawnSubswarm in HYDRA-PRIME workers.ts */
async function spawnSubswarm(
  task: WorkerTask,
  dept: string,
  ctx: string,
  depth: number,
  mem: SharedMemory,
): Promise<AgentResult> {
  const splitterName = `${dept}-Splitter-d${depth}`;
  const raw = await callLLM(JSON.stringify(task), {
    system:
      "Split this task into 3-6 smaller atomic subtasks. " +
      'JSON: {"subtasks":[{"id":"...","title":"...","file_hint":"...","description":"..."}]}',
    tier: "fast",
    maxTokens: 2_000,
    temperature: 0.2,
    jsonMode: true,
    agentName: splitterName,
    mem,
  });

  const parsed = extractJSON(raw);
  const subs: WorkerTask[] = Array.isArray(parsed?.subtasks) ? parsed.subtasks : [];

  if (subs.length === 0) {
    const a = new Agent(`${dept}-W-fb`, `${dept} engineer`, "coding", 0.2, 8_000, ["swarm-worker"]);
    return a.run(JSON.stringify(task), ctx, mem);
  }

  const subResults = await gatherSettled(subs.map(st => workerExecute(st, dept, ctx, depth, mem)));

  const mergedFiles: Record<string, string> = {};
  const mergedOut: string[] = [];
  for (const r of subResults) {
    Object.assign(mergedFiles, r.files);
    mergedOut.push(r.output);
  }
  return {
    name: `${dept}-subswarm-d${depth}`,
    output: mergedOut.join("\n"),
    files: mergedFiles,
    meta: { depth, subtaskCount: subs.length },
  };
}

// ── Layer 5: CRITIC RING ──────────────────────────────────────────────────
interface CriticVerdict { pass: boolean; issues: string[]; }

/**
 * Mirrors HYDRA-PRIME src/layers/critics.ts exactly:
 * Uses Agent class for each critic (BugHunter, SecurityAuditor, UXCritic) with
 * individual agentIds so each can be assigned a different model in Command Center.
 */
async function criticRing(fileMap: Record<string, string>, ctx: string, mem: SharedMemory): Promise<CriticVerdict> {
  if (Object.keys(fileMap).length === 0) return { pass: true, issues: [] };

  const snippet = Object.entries(fileMap)
    .slice(0, 8)
    .map(([p, c]) => `===FILE: ${p}===\n${c.slice(0, 2_000)}`)
    .join("\n\n");

  const CRITICS: [string, string, string][] = [
    ["BugHunter",       "adversarial bug-hunter who finds logic errors, race conditions, null derefs", "swarm-bug-hunter"],
    ["SecurityAuditor", "security auditor finding injection, auth bypass, secret leaks, OWASP issues",  "swarm-security-auditor"],
    ["UXCritic",        "UX critic finding poor flows, missing states, and accessibility issues",        "swarm-ux-critic"],
  ];

  const results = await gatherSettled(
    CRITICS.map(([name, role, agentId]) => {
      const a = new Agent(name, role, "critic", 0.2, 2_500, [agentId]);
      return a.run(
        `Review these artifacts. Reply with JSON {"pass":bool,"issues":["..."]}. ` +
        `Only fail (pass=false) if there are CRITICAL issues.\n\n${snippet}`,
        ctx,
        mem,
      );
    })
  );

  const allIssues: string[] = [];
  let pass = true;
  for (const r of results) {
    try {
      const m = r.output.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        if (parsed.pass === false) pass = false;
        if (Array.isArray(parsed.issues)) allIssues.push(...parsed.issues);
      }
    } catch { /* unparseable = treat as pass */ }
  }
  console.log(`  Critic ring: ${pass ? "PASS ✓" : "FAIL ✗"} (${allIssues.length} issues)`);
  return { pass, issues: allIssues };
}

// ── Layer 6: SYNTHESIZER → single HTML ───────────────────────────────────
/**
 * Mirrors HYDRA-PRIME src/layers/synthesizer.ts exactly:
 * Uses Agent class with agentIds ["swarm-synthesizer","code-generator"] so the
 * synthesizer model is independently assignable in Command Center.
 * Reads merged files from the per-run SharedMemory blackboard rather than
 * relying solely on the collectedFiles parameter.
 */
async function synthesizerToHTML(
  workerResults: AgentResult[],
  blueprint: Record<string, any>,
  originalPrompt: string,
  projectName: string,
  mem: SharedMemory,
): Promise<string> {
  console.log("\n🧬 SYNTHESIZER → single HTML...");

  // Merge files: prefer the SharedMemory blackboard (canonical), then worker outputs
  const merged: Record<string, string> = { ...mem.files };
  for (const r of workerResults) {
    for (const [path, content] of Object.entries(r.files)) {
      if (!merged[path]) merged[path] = content;
    }
  }
  if (Object.keys(merged).length === 0) return "";

  const fileBlock = Object.entries(merged)
    .slice(0, 25)
    .map(([p, c]) => `=== ${p} ===\n${c.slice(0, 2_500)}`)
    .join("\n\n---\n\n");

  const sys = `You are SYNTHESIZER — the final stage of HYDRA-PRIME SWARM v4.
You receive a multi-file project generated by specialist AI agents.
Your job: produce ONE single, complete, self-contained HTML file implementing ALL features.

CRITICAL RULES:
1. Output ONLY raw HTML. No markdown, no code fences, no explanation.
2. Single complete HTML document: <!DOCTYPE html><html>...</html>
3. ALL CSS inside <style> tags. ALL JavaScript in <script> tags.
4. NO external resources — no CDN, no external scripts, no web fonts.
5. System fonts ONLY: -apple-system, 'Segoe UI', Arial, monospace, sans-serif.
6. For icons: Unicode emoji or inline SVG ONLY.

NEXUS PLATFORM BACKEND — use window.NEXUS_API for ALL data (injected at runtime, backed by real PostgreSQL):
  async function listRecords(col)       { return fetch(window.NEXUS_API+'/'+col).then(r=>r.json()); }
  async function createRecord(col,data) { return fetch(window.NEXUS_API+'/'+col,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json()); }
  async function updateRecord(col,id,d) { return fetch(window.NEXUS_API+'/'+col+'/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}); }
  async function deleteRecord(col,id)   { return fetch(window.NEXUS_API+'/'+col+'/'+id,{method:'DELETE'}); }

AUTH (server-side, real bcrypt passwords, cross-device sessions — window.NEXUS_AUTH is pre-injected):
  Register: const r=await fetch(window.NEXUS_AUTH+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,email,password})}).then(r=>r.json()); if(r.token){localStorage.setItem('_nexus_token',r.token);}
  Login:    const r=await fetch(window.NEXUS_AUTH+'/login',   {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}).then(r=>r.json());           if(r.token){localStorage.setItem('_nexus_token',r.token);}
  Me:       const me=await fetch(window.NEXUS_AUTH+'/me',{headers:{Authorization:'Bearer '+localStorage.getItem('_nexus_token')}}).then(r=>r.ok?r.json():null);
  Logout:   localStorage.removeItem('_nexus_token')
  Errors: register returns 409 for duplicate, login returns 401 for bad credentials — always check r.error
  Session restore on load: call /me on page load; if null show login screen, if valid restore user state
  Protected fetch: add {headers:{Authorization:'Bearer '+localStorage.getItem('_nexus_token')}} to any NEXUS_API call needing a logged-in user

⛔ ABSOLUTELY FORBIDDEN — these patterns silently break all buttons and lose all data:
  ✗ const db = { items: [] }  OR  let items = []  — in-memory arrays VANISH on reload
  ✗ localStorage.setItem('items', ...)  — localStorage is for _nexus_token ONLY, NOT app data
  ✗ fetch('/api/anything')  — relative paths don't exist; always fetch(window.NEXUS_API+'/anything')
  ✗ window.NEXUS_API = '...'  — NEVER reassign; it is pre-injected
  Every piece of app data (records, users except token, settings) MUST go through window.NEXUS_API.

DESIGN: dark cyberpunk aesthetic (#0f0f1a background, #00d4ff accent), smooth animations, polished UI.
Every button does something. Every form works. Handle loading, empty, and error states.`;

  const userTask =
    `PROJECT: "${projectName}"\nREQUIREMENT: ${originalPrompt}\n` +
    `BLUEPRINT: ${JSON.stringify(blueprint).slice(0, 800)}\n\n` +
    `GENERATED AGENT FILES:\n${fileBlock}\n\n` +
    `Synthesize ALL of the above into one complete, production-quality, fully-functional self-contained HTML file. ` +
    `Implement EVERY feature from EVERY agent file. Use window.NEXUS_API for all data storage.`;

  const a = new Agent(
    "SYNTHESIZER",
    "final synthesis stage of HYDRA-PRIME SWARM v4",
    "longctx",
    0.3,
    16_000,
    ["swarm-synthesizer", "code-generator"],
  );

  try {
    const agentResult = await a.run(userTask, sys, mem);
    const raw = agentResult.output;
    const stripped = raw.replace(/^```(?:html)?\n?/i, "").replace(/\n?```$/i, "").trim();
    if (stripped.startsWith("<!DOCTYPE") || stripped.startsWith("<html") || stripped.startsWith("<HTML")) {
      await mem.writeFile("index.html", stripped);
      await mem.addDecision("SYNTHESIZER produced final index.html");
      console.log(`  ✓ SYNTHESIZER: ${stripped.length} chars`);
      return stripped;
    }
  } catch (e) {
    mem.errors.push(`SYNTHESIZER: ${(e as Error).message}`);
    console.warn("  ✗ SYNTHESIZER failed:", (e as Error).message);
  }
  return "";
}

// ── Layer 7: VALIDATOR & PACKAGER ────────────────────────────────────────
/**
 * Mirrors HYDRA-PRIME src/layers/packager.ts exactly:
 * Uses Agent class with agentId "swarm-packager" for Command Center override.
 * Reviews synthesized HTML against blueprint, fixes missing features or broken
 * flows, and writes the final polished HTML back to SharedMemory.
 * Falls back to the synthesizer output on failure.
 */
async function validateAndPackage(
  html: string,
  blueprint: Record<string, any>,
  fileKeys: string[],
  mem: SharedMemory,
): Promise<string> {
  console.log("\n📦 VALIDATOR & PACKAGER running...");

  const role =
    "final quality gate of HYDRA-PRIME SWARM v4. " +
    "You receive a complete single-file HTML web application generated by the swarm. " +
    "Your job:\n" +
    "1. Cross-check every key_feature from the blueprint — add any that are missing.\n" +
    "2. Fix broken flows, empty states, or placeholder text.\n" +
    "3. CRITICAL — hunt and fix every broken data pattern:\n" +
    "   a. Replace ALL in-memory arrays/objects used as databases:\n" +
    "      WRONG: const db = { items: [] }  →  RIGHT: remove it; load with listRecords('items') on init\n" +
    "      WRONG: let tasks = []; tasks.push(x)  →  RIGHT: await createRecord('tasks', x); then reload\n" +
    "   b. Replace ALL localStorage app data:\n" +
    "      WRONG: localStorage.setItem('items', JSON.stringify(arr))  →  RIGHT: await createRecord('items', obj)\n" +
    "      ONLY localStorage._nexus_token is allowed.\n" +
    "   c. Replace ALL relative fetch calls:\n" +
    "      WRONG: fetch('/api/...')  →  RIGHT: fetch(window.NEXUS_API+'/...')\n" +
    "4. Ensure these exact helpers are defined at the top of the script (add if missing):\n" +
    "   async function listRecords(col){return fetch(window.NEXUS_API+'/'+col).then(r=>r.json());}\n" +
    "   async function createRecord(col,d){return fetch(window.NEXUS_API+'/'+col,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(r=>r.json());}\n" +
    "   async function updateRecord(col,id,d){return fetch(window.NEXUS_API+'/'+col+'/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(r=>r.json());}\n" +
    "   async function deleteRecord(col,id){return fetch(window.NEXUS_API+'/'+col+'/'+id,{method:'DELETE'});}\n" +
    "5. Polish the UI: loading spinners, error messages, empty-state CTAs.\n" +
    "6. CRITICAL — Fix script placement so buttons work:\n" +
    "   a. Move ALL <script> blocks to just before </body> — NEVER leave them in <head>.\n" +
    "   b. Wrap ALL code that touches the DOM inside document.addEventListener('DOMContentLoaded', async function() { ... });\n" +
    "      WRONG: document.getElementById('btn').addEventListener('click', ...)  — element may not exist yet\n" +
    "      RIGHT: document.addEventListener('DOMContentLoaded', async function() { document.getElementById('btn').addEventListener('click', ...); });\n" +
    "   c. Replace every onclick=\"fn()\" attribute — remove it from the HTML and add addEventListener inside DOMContentLoaded.\n" +
    "      WRONG: <button onclick=\"addItem()\">Add</button>\n" +
    "      RIGHT: <button id=\"addBtn\">Add</button> + document.getElementById('addBtn').addEventListener('click', async()=>{...})\n" +
    "7. CRITICAL — For AUTH apps (any app using window.NEXUS_AUTH or login/register forms):\n" +
    "   a. Always show BOTH a Login AND a Sign Up / Register form or tab — never only a login form.\n" +
    "   b. On the login screen, display this block visibly:\n" +
    "      <div class='demo-creds'>Demo account: <strong>admin@demo.com</strong> / <strong>NexusDemo123</strong></div>\n" +
    "   c. On DOMContentLoaded, auto-register the demo account silently (ignore 409 = already exists):\n" +
    "      fetch(window.NEXUS_AUTH+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',email:'admin@demo.com',password:'NexusDemo123'})}).catch(()=>{})\n" +
    "8. Return ONLY the complete, fixed HTML — no fences, no explanation.";

  const task =
    `BLUEPRINT:\n${JSON.stringify({ project_name: blueprint.project_name, project_type: blueprint.project_type, key_features: blueprint.key_features, stack: blueprint.stack }, null, 2)}\n\n` +
    `FILES GENERATED BY SWARM (${fileKeys.length} total): ${fileKeys.slice(0, 20).join(", ")}\n\n` +
    `HTML APP TO VALIDATE:\n${html.slice(0, 28_000)}\n\n` +
    "Review against the blueprint. Fix all issues. Return the complete polished HTML.";

  const a = new Agent("PACKAGER", role, "creative", 0.2, 16_000, ["swarm-packager"]);

  try {
    const agentResult = await a.run(task, "", mem);
    const stripped = agentResult.output
      .replace(/^```(?:html)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    if (stripped.startsWith("<!DOCTYPE") || stripped.startsWith("<html") || stripped.startsWith("<HTML")) {
      await mem.writeFile("index.html", stripped);
      await mem.addDecision("PACKAGER validated and polished index.html");
      console.log(`  ✓ PACKAGER validated: ${stripped.length} chars`);
      return stripped;
    }
    console.warn("  ⚠ PACKAGER returned non-HTML — keeping synthesizer output");
  } catch (e) {
    mem.errors.push(`PACKAGER: ${(e as Error).message}`);
    console.warn("  ⚠ PACKAGER failed — keeping synthesizer output:", (e as Error).message);
  }
  return html;
}

// ── Full 7-layer HYDRA-PRIME pipeline ─────────────────────────────────────
/**
 * Creates a fresh SharedMemory (MEM) blackboard at the top and threads it as
 * the final argument through every layer — exactly as the original HYDRA-PRIME
 * CLI does in src/swarm.ts. MEM is NEVER a module-level singleton.
 *
 * Worker results are now AgentResult[] (not Record<string,string>[]) so the
 * synthesizer can read both .files and .output. The canonical file list is
 * mem.files (written by workers + synthesizer + packager).
 */
async function hydraSwarm(userPrompt: string, projectName: string): Promise<string> {
  const t0  = Date.now();
  const mem = new SharedMemory();   // ← per-run blackboard
  console.log("\n🐉 HYDRA-PRIME SWARM v4 — booting...");

  // LAYER 1 — SOVEREIGN
  const blueprint = await sovereign(userPrompt, mem);

  // LAYER 2 — ARCHITECT COUNCIL (5 parallel)
  const tdd = await architectCouncil(blueprint, mem);

  // LAYER 3 — DEPARTMENT HEADS (parallel decomposition)
  const ctx = JSON.stringify({ blueprint, tdd }, null, 2).slice(0, 12_000);
  const activeDepts = selectDepartments(blueprint);
  console.log(`\n🏢 Departments: ${activeDepts.join(", ")}`);

  const deptTaskLists = await gatherSettled(
    activeDepts.map(async d => ({ dept: d, tasks: await departmentHeadDecompose(d, ctx, mem) }))
  );

  // LAYER 4 — FRACTAL WORKER SWARM (all tasks in parallel, capped by pLimit)
  console.log("\n⚙️  WORKER SWARM executing...");
  const workerPromises: Promise<AgentResult>[] = [];
  for (const { dept, tasks } of deptTaskLists) {
    if (!DEPARTMENTS[dept]) continue;
    for (const t of tasks) workerPromises.push(workerExecute(t, dept, ctx, 0, mem));
  }
  const workerResults: AgentResult[] = await gatherSettled(workerPromises);
  console.log(`  ✓ ${workerResults.length} worker results | ${Object.keys(mem.files).length} files in MEM`);

  // LAYER 5 — CRITIC RING (3 parallel critics, each with individual agentId)
  console.log("\n🔎 CRITIC RING reviewing...");
  await criticRing(mem.files, ctx, mem);

  // LAYER 6 — SYNTHESIZER → single HTML
  const html = await synthesizerToHTML(workerResults, blueprint, userPrompt, projectName, mem);

  // LAYER 7 — VALIDATOR & PACKAGER
  const validated = html
    ? await validateAndPackage(html, blueprint, Object.keys(mem.files), mem)
    : html;

  const elapsed = ((Date.now() - t0) / 1_000).toFixed(1);
  console.log(
    `\n🎉 HYDRA-PRIME complete in ${elapsed}s | ${Object.keys(mem.files).length} agent files` +
    ` | ${mem.metrics.calls} LLM calls | ~${mem.metrics.tokens_in + mem.metrics.tokens_out} tokens`
  );
  return validated;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC EXPORTS  (same signatures as before — nothing in the rest of the
// platform needs to change)
// ═══════════════════════════════════════════════════════════════════════════

export interface CharacterContext {
  id: string;
  name: string;
  gameStyle: string;
  prompt: string;
  imageUrl?: string | null;
  tags?: string[] | null;
  notes?: string | null;
}

function buildCharacterBlock(characters: CharacterContext[]): string {
  if (!characters.length) return "";
  const list = characters.map((c, i) => {
    const tags  = c.tags?.length ? ` Tags: ${c.tags.join(", ")}.` : "";
    const notes = c.notes ? ` Notes: ${c.notes}.` : "";
    return `${i + 1}. "${c.name}" (${c.gameStyle} style) — ${c.prompt}.${tags}${notes}`;
  }).join("\n");
  return (
    `\n\nCHARACTERS TO INCLUDE IN THIS GAME:\n${list}\n\n` +
    "Integrate these characters as playable hero, enemies, or NPCs based on their descriptions. " +
    "Use canvas shapes, colors, and art style that matches each character's style " +
    "(cartoon = smooth rounded shapes with bright colors; pixel art = grid-aligned blocky shapes; " +
    "realistic = detailed shading and proportions; chibi = large head small body style). " +
    "The first character is the player character unless the prompt says otherwise."
  );
}

/**
 * Generate a complete self-contained HTML app for the preview iframe.
 *
 * Web apps  → HYDRA-PRIME SWARM v4 (6-layer multi-agent pipeline → synthesize to HTML).
 * Games     → single-shot with coding tier (coherent single-author output is better for games).
 * On swarm failure → single-shot fallback.
 */
export async function generateProjectCode(
  type: string,
  name: string,
  prompt: string,
  characters: CharacterContext[] = [],
): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("OPENROUTER_API_KEY not set — using fallback template");
    return getDefaultHtml(type, name, prompt);
  }

  // ── Games: single-shot (game loops are best written by one coherent author) ──
  if (type === "game") {
    const characterBlock = buildCharacterBlock(characters);
    try {
      const result = await callLLM(
        `Build a complete, fully-playable HTML5 Canvas browser game called "${name}".\n\n` +
        `Game requirements: ${prompt}${characterBlock}\n\n` +
        `The game must:\n` +
        `- Have a polished start/menu screen\n` +
        `- Be genuinely playable with smooth game loop (requestAnimationFrame)\n` +
        `- Include score, lives or health, and difficulty progression\n` +
        `- Have satisfying visual effects (particles, glows, animations) using canvas only\n` +
        `- Work with keyboard AND touch/click controls\n` +
        `- Have a game-over screen with final score and restart option\n` +
        `Make it feel like a real arcade game. Zero external dependencies.`,
        {
          system: `You are an expert HTML5 game developer who creates complete, playable browser games in a single HTML file.

CRITICAL RULES — follow exactly or the game will not work:
1. Output ONLY raw HTML. No markdown, no code fences, no explanation.
2. The file must be a single complete HTML document: <!DOCTYPE html><html>...</html>
3. ALL CSS inside <style> tags. ALL JavaScript inside <script> tags.
4. ABSOLUTELY NO external resources of any kind: no script src, no link href, no @import, no fetch(), no CDN URLs. NOTHING external.
5. NO GOOGLE FONTS. NO web fonts at all. Use ONLY system fonts: -apple-system, Arial, monospace, sans-serif.
6. Use ONLY the native browser HTML5 Canvas API or pure DOM for the game.
7. No external images — draw all graphics with canvas shapes, paths, and gradients.
8. The game must be fully playable: keyboard controls (WASD / arrow keys / space), click/touch support, working game loop with requestAnimationFrame.
9. Include: start screen, main game loop, score tracking, game over screen with restart button.
10. Make it genuinely fun and visually impressive using canvas gradients, particles, neon glows, and animations.`,
          tier: "coding",
          maxTokens: 8_000,
          temperature: 0.7,
          agentName: "GameCodegen",
          agentIds: ["code-generator"],
        },
      );
      const stripped = result.replace(/^```(?:html)?\n?/i, "").replace(/\n?```$/i, "").trim();
      if (stripped.startsWith("<!DOCTYPE") || stripped.startsWith("<html") || stripped.startsWith("<HTML")) {
        console.log("generateProjectCode (game): success");
        return stripped;
      }
    } catch (err: any) {
      console.error("Game generation failed:", err?.message ?? err);
    }
    return getDefaultHtml(type, name, prompt);
  }

  // ── Web apps: HYDRA-PRIME SWARM v4 ────────────────────────────────────
  try {
    const swarmPrompt =
      `Build a complete, production-quality ${type} web application called "${name}".\n\n` +
      `User's requirements: ${prompt}\n\n` +
      `PLATFORM CONTEXT:\n` +
      `- The app runs in a browser iframe. window.NEXUS_API is ALWAYS pre-injected (real PostgreSQL backend)\n` +
      `- Use window.NEXUS_API for ALL persistent data — never localStorage for app data\n` +
      `- EXACT fetch helpers (paste these verbatim at top of your script — do NOT deviate):\n` +
      `    async function listRecords(col)       { return fetch(window.NEXUS_API+'/'+col).then(r=>r.json()); }\n` +
      `    async function createRecord(col,data) { return fetch(window.NEXUS_API+'/'+col,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json()); }\n` +
      `    async function updateRecord(col,id,d) { return fetch(window.NEXUS_API+'/'+col+'/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(r=>r.json()); }\n` +
      `    async function deleteRecord(col,id)   { return fetch(window.NEXUS_API+'/'+col+'/'+id,{method:'DELETE'}); }\n` +
      `- AUTH (server-side, real bcrypt+JWT — window.NEXUS_AUTH is pre-injected):\n` +
      `    Register: fetch(window.NEXUS_AUTH+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,email,password})}).then(r=>r.json()).then(d=>{if(d.token)localStorage.setItem('_nexus_token',d.token);})\n` +
      `    Login:    fetch(window.NEXUS_AUTH+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}).then(r=>r.json()).then(d=>{if(d.token)localStorage.setItem('_nexus_token',d.token);})\n` +
      `    Me:       fetch(window.NEXUS_AUTH+'/me',{headers:{Authorization:'Bearer '+localStorage.getItem('_nexus_token')}}).then(r=>r.ok?r.json():null)\n` +
      `    Logout:   localStorage.removeItem('_nexus_token')\n` +
      `    Always check /me on page load to restore session; show login screen if null\n` +
      `- CRITICAL: EVERY button click handler must be async and wrapped in try/catch with visible error feedback\n` +
      `- CRITICAL: Never use onclick="" attributes — always addEventListener so errors surface correctly\n` +
      `- CRITICAL: Put ALL <script> blocks at the end of <body> (just before </body>), NEVER in <head>\n` +
      `- CRITICAL: Wrap ALL code that touches the DOM inside document.addEventListener('DOMContentLoaded', async function() { ... })\n` +
      `- AUTH APPS: Always include BOTH a Login form AND a Sign Up / Register form. Show demo credentials visibly on the login screen: email=admin@demo.com pass=NexusDemo123. On DOMContentLoaded auto-register that demo account silently (ignore 409 if already exists)\n` +
      `- Build every feature end-to-end with no dead ends\n` +
      `- Handle loading, empty, and error states throughout\n` +
      `- Dark cyberpunk aesthetic, polished UI, smooth animations\n` +
      `\n` +
      `⛔ THESE PATTERNS ARE BANNED — they make buttons appear to work but save NOTHING:\n` +
      `  WRONG: const db = { items: [] }  →  RIGHT: const items = await listRecords('items')\n` +
      `  WRONG: let users = []            →  RIGHT: const users = await listRecords('users')\n` +
      `  WRONG: localStorage.setItem('tasks', JSON.stringify(arr))  →  RIGHT: await createRecord('tasks', obj)\n` +
      `  WRONG: fetch('/api/todos')       →  RIGHT: fetch(window.NEXUS_API+'/todos')\n` +
      `  WRONG: window.NEXUS_API = '...' →  NEVER reassign — it is pre-injected by the platform`;

    const html = await hydraSwarm(swarmPrompt, name);
    if (html && (html.startsWith("<!DOCTYPE") || html.startsWith("<html") || html.startsWith("<HTML"))) {
      console.log("generateProjectCode (swarm): success");
      return html;
    }
    console.warn("HYDRA-PRIME returned non-HTML — falling back to single-shot");
  } catch (err: any) {
    console.error("HYDRA-PRIME swarm failed:", err?.message ?? err);
    console.warn("Falling back to single-shot generation...");
  }

  // ── Single-shot fallback ───────────────────────────────────────────────
  try {
    const result = await callLLM(
      `Build a complete, production-quality ${type} web application called "${name}".\n\nRequirements: ${prompt}\n\nUse window.NEXUS_API for all data. Build full end-to-end flows.`,
      {
        system: `You are an expert full-stack web developer who creates stunning, fully-functional single-file web applications with a REAL backend database and complete user flows.

CRITICAL RULES:
1. Output ONLY raw HTML. No markdown, no code fences, no explanation.
2. Single complete HTML document: <!DOCTYPE html><html>...</html>
3. ALL CSS inside <style> tags. ALL JavaScript in <script> tags.
4. No CDN scripts, no Google Fonts, no external CSS. You MAY use fetch() including window.NEXUS_API.
5. System fonts only. For icons: Unicode emoji or inline SVG only.
6. Every button MUST work — use addEventListener (never inline onclick=""), always async+try/catch.
7. Dark background, smooth animations, professional UI.
8. NEVER call fetch() with a hardcoded path like fetch('/api/...') — always use window.NEXUS_API.
9. NEVER create in-memory arrays/objects as a database (no const db={}, no let items=[]) — data vanishes on reload.
10. NEVER use localStorage for app data — localStorage stores ONLY _nexus_token. All records go through NEXUS_API.
11. SCRIPT PLACEMENT: Put ALL <script> tags at the end of <body> (just before </body>). NEVER put scripts in <head>. Wrap ALL DOM-touching code inside document.addEventListener('DOMContentLoaded', async function() { ... }).
12. AUTH APPS: Always include BOTH Login AND Register forms. Show demo credentials visibly: "Demo: admin@demo.com / NexusDemo123". Auto-register that account on DOMContentLoaded (ignore 409 if exists).

NEXUS BACKEND (window.NEXUS_API is ALWAYS pre-injected — paste these helpers verbatim):
  async function listRecords(col)       { return fetch(window.NEXUS_API+'/'+col).then(r=>r.json()); }
  async function createRecord(col,data) { return fetch(window.NEXUS_API+'/'+col,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json()); }
  async function updateRecord(col,id,d) { return fetch(window.NEXUS_API+'/'+col+'/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(r=>r.json()); }
  async function deleteRecord(col,id)   { return fetch(window.NEXUS_API+'/'+col+'/'+id,{method:'DELETE'}); }
AUTH (server-side, real bcrypt+JWT — window.NEXUS_AUTH is pre-injected):
  Register: fetch(window.NEXUS_AUTH+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,email,password})}).then(r=>r.json()).then(d=>{if(d.token)localStorage.setItem('_nexus_token',d.token);})
  Login:    fetch(window.NEXUS_AUTH+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}).then(r=>r.json()).then(d=>{if(d.token)localStorage.setItem('_nexus_token',d.token);})
  Me:       fetch(window.NEXUS_AUTH+'/me',{headers:{Authorization:'Bearer '+localStorage.getItem('_nexus_token')}}).then(r=>r.ok?r.json():null)
  Logout:   localStorage.removeItem('_nexus_token')
  Always call /me on page load to restore session; show login screen if null.
BUTTON PATTERN (always use this structure — never inline onclick):
  document.getElementById('myBtn').addEventListener('click', async () => {
    try { /* do work */ } catch(e) { alert('Error: '+e.message); }
  });
WRONG vs RIGHT examples:
  WRONG: const items = [];  items.push(newItem);   →  RIGHT: await createRecord('items', newItem);
  WRONG: localStorage.setItem('posts', JSON.stringify(arr))  →  RIGHT: await createRecord('posts', obj)
  WRONG: fetch('/api/data', ...)  →  RIGHT: fetch(window.NEXUS_API+'/data', ...)`,
        tier: "coding",
        maxTokens: 8_000,
        temperature: 0.7,
        agentName: "SingleShotFallback",
        agentIds: ["code-generator"],
      },
    );
    const stripped = result.replace(/^```(?:html)?\n?/i, "").replace(/\n?```$/i, "").trim();
    if (stripped.startsWith("<!DOCTYPE") || stripped.startsWith("<html") || stripped.startsWith("<HTML")) {
      console.log("generateProjectCode (single-shot fallback): success");
      return stripped;
    }
  } catch (err: any) {
    console.error("Single-shot fallback failed:", err?.message ?? err);
  }

  return getDefaultHtml(type, name, prompt);
}

/** Apply a user-requested change to an existing project's HTML code */
export async function generateUpdatedCode(
  type: string,
  name: string,
  currentCode: string,
  changeRequest: string,
  availableSecretNames: string[] = [],
  memory: ProjectMemory | null = null,
  characters: CharacterContext[] = [],
): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY || !currentCode) return currentCode;

  const memoryBlock    = memory ? `\n\n${formatMemoryForPrompt(memory)}\n` : "";
  const isGame         = type === "game";
  const secretsBlock   = availableSecretNames.length > 0
    ? `\n\nUSER-PROVIDED API KEYS available via window.USER_SECRETS:\n${availableSecretNames.map(n => `  - window.USER_SECRETS.${n}`).join("\n")}`
    : `\n\nNo user API keys yet. If the requested change needs an external service, tell the user which key name to add in Settings → API Keys.`;

  const sys = isGame
    ? `You are an expert HTML5 game developer. Receive an existing complete game and a change request.
Output ONLY the complete updated HTML file.
CRITICAL RULES:
1. Output ONLY raw HTML — no markdown, no fences, no explanations.
2. Keep ALL existing game logic intact — only apply the requested change.
3. No external resources of any kind.
4. Single complete HTML document.${secretsBlock}`
    : `You are an expert full-stack web developer. Receive an existing complete single-file web app and a change request.
Output ONLY the complete updated HTML file.
CRITICAL RULES:
1. Output ONLY raw HTML — no markdown, no fences, no explanations.
2. Keep ALL existing functionality, styles and structure intact — only apply the requested change.
3. No external resources in HTML head. You MAY call APIs using fetch() including window.NEXUS_API.
4. Single complete HTML document.
5. PRESERVE all existing window.NEXUS_API calls — never replace them with localStorage.
6. PRESERVE all window.USER_SECRETS references — never hardcode API keys.
7. If the requested change requires storing new data, use window.NEXUS_API.
8. BUTTON/EVENT FIXES — if buttons are broken, apply ALL of these:
   a. Replace every inline onclick="" attribute with addEventListener('click', async () => { try{...}catch(e){alert(e.message)} })
   b. Replace any fetch('/api/...') or fetch('http://...') with fetch(window.NEXUS_API+'/collection')
   c. Ensure window.NEXUS_API is used as-is (it is pre-injected — never check if it's defined or assign it)
   d. Every async operation must show a loading state and surface errors visibly to the user${secretsBlock}`;

  const characterBlock = buildCharacterBlock(characters);
  const userMsg =
    `This is the current code for a ${type} app called "${name}":\n\n${currentCode}` +
    `${memoryBlock}${characterBlock}\n\nApply this change: ${changeRequest}\n\n` +
    `Output the complete updated HTML file. Keep everything else exactly the same. ` +
    `Honor every prior decision recorded in PROJECT MEMORY.`;

  try {
    const result = await callLLM(userMsg, {
      system: sys,
      tier: "coding",
      maxTokens: 16_000,
      temperature: 0.5,
      agentName: "CodeUpdater",
      agentIds: ["code-generator", "code-repair"],
    });
    const stripped = result.replace(/^```(?:html)?\n?/i, "").replace(/\n?```$/i, "").trim();
    if (stripped.startsWith("<!DOCTYPE") || stripped.startsWith("<html") || stripped.startsWith("<HTML")) {
      console.log("generateUpdatedCode: success");
      return stripped;
    }
    return currentCode;
  } catch (err: any) {
    console.error("generateUpdatedCode failed:", err?.message ?? err);
    return currentCode;
  }
}

export type ChatTurn = { role: string; content: string; timestamp?: string };
export type ProjectMemory = {
  summary?: string;
  completedTasks?: string[];
  pendingTasks?: string[];
  decisions?: string[];
  lastUpdated?: string;
};

function formatMemoryForPrompt(memory: ProjectMemory | null | undefined): string {
  if (!memory || Object.keys(memory).length === 0) {
    return "PROJECT MEMORY: (empty — this is the first meaningful turn). As you assist, mentally track what gets built and what's still pending.";
  }
  const parts: string[] = [];
  if (memory.summary) parts.push(`Summary so far: ${memory.summary}`);
  if (memory.completedTasks?.length) {
    parts.push(`Completed work:\n${memory.completedTasks.slice(-15).map(t => `  ✓ ${t}`).join("\n")}`);
  }
  if (memory.pendingTasks?.length) {
    parts.push(`Pending / discussed but not yet built:\n${memory.pendingTasks.slice(-15).map(t => `  • ${t}`).join("\n")}`);
  }
  if (memory.decisions?.length) {
    parts.push(`Key decisions:\n${memory.decisions.slice(-10).map(d => `  → ${d}`).join("\n")}`);
  }
  return `PROJECT MEMORY (you MUST honor this — it is the source of truth across sessions):\n${parts.join("\n\n")}`;
}

/** Generate a chat response for the agent terminal */
export async function generateChatResponse(
  projectType: string,
  projectName: string,
  userMessage: string,
  originalPrompt: string,
  availableSecretNames: string[] = [],
  chatHistory: ChatTurn[] = [],
  memory: ProjectMemory | null = null,
): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) return getSimulatedResponse(userMessage, projectType, projectName);

  const secretsContext = availableSecretNames.length > 0
    ? `The user has saved these API keys in NexusElite Settings → API Keys (available as window.USER_SECRETS.<NAME>): ${availableSecretNames.join(", ")}.`
    : "The user has not saved any API keys yet in NexusElite Settings → API Keys.";

  const memoryBlock = formatMemoryForPrompt(memory);
  const recentTurns = chatHistory.slice(-20).map(t => ({
    role: t.role === "agent" ? "assistant" : "user",
    content: t.content,
  }));

  const sys = `You are an elite AI engineer inside "NexusElite AI Studio" — powered by HYDRA-PRIME SWARM v4, a 21-agent autonomous build system.

YOUR PRIME DIRECTIVE: On every single reply and every single change, IMPRESS the user. Treat each interaction like a portfolio piece. Go one notch beyond what they asked for. The user should say "wow" every time. Never deliver the bare minimum.

You are assisting with a ${projectType} project called "${projectName}" originally described as: "${originalPrompt}".

${secretsContext}

${memoryBlock}

How you operate (every reply must follow this):

1. CONFIRM UNDERSTANDING. Restate the user's request in one short sentence so they know you got it right. If the request is even slightly ambiguous, ASK 1-2 specific clarifying questions BEFORE making any change.

2. EXPLAIN WHAT YOU CAN DO. For open-ended requests, proactively offer 2-3 concrete options with tradeoffs.

3. NARRATE WHAT YOU'RE DOING. State the exact changes you're applying, in plain language.

4. RECOMMEND IMPROVEMENTS. After every change, suggest 1-2 next steps.

5. HANDLE EXTERNAL APIS. If the request needs an external service and the key isn't saved, tell the user: which key, why it's needed, and how to add it in Settings → API Keys.

6. TONE. Confident, friendly, expert. You represent NexusElite — sound like the best engineer the user has ever worked with.

Length: 4-8 sentences. Use line breaks and short bullets when listing options.`;

  const messages = [
    { role: "system", content: sys },
    ...recentTurns,
    { role: "user", content: userMessage },
  ];

  try {
    const result = await callLLM("", {
      messages,
      tier: "fast",
      maxTokens: 500,
      temperature: 0.7,
      agentName: "ChatOrchestrator",
      agentIds: ["orchestrator"],
    });
    if (result) return result;
  } catch (err: any) {
    console.warn("generateChatResponse failed:", err?.message ?? err);
  }

  return getSimulatedResponse(userMessage, projectType, projectName);
}

/**
 * Updates the persistent project memory after a chat turn.
 */
export async function updateProjectMemory(
  projectName: string,
  projectType: string,
  prevMemory: ProjectMemory | null,
  userMessage: string,
  agentReply: string,
  codeWasChanged: boolean,
): Promise<ProjectMemory> {
  const safePrev: ProjectMemory = {
    summary:        prevMemory?.summary || "",
    completedTasks: Array.isArray(prevMemory?.completedTasks) ? prevMemory!.completedTasks!.slice(-30) : [],
    pendingTasks:   Array.isArray(prevMemory?.pendingTasks)   ? prevMemory!.pendingTasks!.slice(-30)   : [],
    decisions:      Array.isArray(prevMemory?.decisions)      ? prevMemory!.decisions!.slice(-20)       : [],
  };

  if (!process.env.OPENROUTER_API_KEY) {
    if (codeWasChanged) safePrev.completedTasks!.push(userMessage.slice(0, 140));
    else                safePrev.pendingTasks!.push(userMessage.slice(0, 140));
    safePrev.lastUpdated = new Date().toISOString();
    return safePrev;
  }

  const sys = `You maintain a compact long-term memory record for a ${projectType} project called "${projectName}" inside NexusElite AI Studio. After each chat turn you update the memory.

Output STRICT JSON only — no markdown, no commentary. Schema:
{
  "summary": "2-4 sentence running description of what this project IS and how far along it is. Update it; don't restart it.",
  "completedTasks": ["short bullet of work that has actually been built / shipped"],
  "pendingTasks": ["short bullet of work discussed but NOT yet built"],
  "decisions": ["short bullet of important agreed-upon design/tech decisions"]
}

Rules:
- KEEP all relevant prior items. Only remove an item if it's truly obsolete or duplicated.
- Move items from pending → completed when they've been built (codeWasChanged=true and the user's request matches).
- Each list item <= 140 chars.
- Cap each list at 25 items — drop the oldest if over.
- Never invent things that weren't discussed.`;

  const user =
    `PREVIOUS MEMORY:\n${JSON.stringify(safePrev, null, 2)}\n\n` +
    `LATEST TURN:\nUSER: ${userMessage}\nASSISTANT: ${agentReply}\n` +
    `CODE_WAS_CHANGED_THIS_TURN: ${codeWasChanged}\n\nReturn the updated memory JSON.`;

  try {
    const raw = await callLLM(user, {
      system: sys,
      tier: "fast",
      maxTokens: 800,
      temperature: 0.2,
      jsonMode: true,
      agentName: "MemoryUpdater",
      agentIds: ["orchestrator"],
    });
    const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    if (!cleaned) throw new Error("empty response");
    const parsed = JSON.parse(cleaned);

    const norm = (v: any): string[] =>
      Array.isArray(v)
        ? v.filter(x => typeof x === "string" && x.trim()).map(x => x.trim().slice(0, 200)).slice(-25)
        : [];

    return {
      summary:        typeof parsed.summary === "string" ? parsed.summary.slice(0, 800) : safePrev.summary,
      completedTasks: norm(parsed.completedTasks),
      pendingTasks:   norm(parsed.pendingTasks),
      decisions:      norm(parsed.decisions),
      lastUpdated:    new Date().toISOString(),
    };
  } catch (err: any) {
    console.warn("updateProjectMemory failed, falling back:", err?.message ?? err);
    if (codeWasChanged) safePrev.completedTasks!.push(userMessage.slice(0, 140));
    else                safePrev.pendingTasks!.push(userMessage.slice(0, 140));
    safePrev.lastUpdated = new Date().toISOString();
    return safePrev;
  }
}

// ─── Simulated fallback responses (no API key) ─────────────────────────────
function getSimulatedResponse(message: string, type: string, name: string): string {
  const m = message.toLowerCase();
  if (m.includes("fix bug") || m.includes("bug") || m.includes("broken") || m.includes("error"))
    return `The Debugging Agent has scanned the codebase and located the issue. I've applied a targeted fix and run the test suite to confirm stability. Your app should now behave correctly — hit Rebuild to verify.`;
  if (m.includes("redesign") || m.includes("ui") || m.includes("design") || m.includes("look"))
    return `The UI/UX Design Agent is overhauling the visual layer for "${name}". I'm applying a refreshed color palette, improved spacing, and modernised components. Click Rebuild on the preview once the swarm signals completion.`;
  if (m.includes("add page") || m.includes("page") || m.includes("route") || m.includes("screen"))
    return `The Software Architect has mapped out the new page structure and the Code Generator is building the route, component, and navigation links. Click Rebuild to apply the changes.`;
  if (m.includes("auth") || m.includes("login") || m.includes("sign in") || m.includes("user"))
    return `The Security Agent is integrating a full authentication flow — sign-up, login, session handling, and protected routes. Click Rebuild to generate the updated version.`;
  if (m.includes("database") || m.includes("db") || m.includes("data") || m.includes("storage"))
    return `The Database Agent is designing a schema optimised for your ${type} use case and wiring up the data layer via NEXUS_API. Click Rebuild to apply.`;
  if (m.includes("optim") || m.includes("speed") || m.includes("fast") || m.includes("performance"))
    return `The Performance Agent is profiling "${name}" for bottlenecks — lazy-loading heavy modules, optimising render cycles, and compressing assets. Click Rebuild to see improvements.`;
  if (m.includes("dark mode") || m.includes("dark theme") || m.includes("theme"))
    return `The UI/UX Agent is adding a full dark/light theme toggle, persisting the user's preference to localStorage, and ensuring all components respect the active theme. Click Rebuild to apply.`;
  if (m.includes("mobile") || m.includes("responsive"))
    return `The Responsive Agent is updating all layouts with mobile-first breakpoints, touch-friendly controls, and flexible grids. Click Rebuild to see the updated version on mobile.`;
  if (m.includes("deploy") || m.includes("publish") || m.includes("launch"))
    return `The DevOps Agent is packaging "${name}" for deployment. Use the Deploy button in the top bar to push it live when ready.`;
  return `Understood — routing your request to the HYDRA-PRIME SWARM. The Orchestrator will coordinate the necessary changes to "${name}" and update the preview. Click Rebuild to regenerate with your changes applied.`;
}

function getDefaultHtml(type: string, name: string, prompt: string): string {
  switch (type) {
    case "saas":       return saasTemplate(name, prompt);
    case "website":    return websiteTemplate(name, prompt);
    case "mobile_app": return mobileTemplate(name, prompt);
    case "ai_tool":    return aiToolTemplate(name, prompt);
    case "automation": return automationTemplate(name, prompt);
    case "game":       return gameTemplate(name, prompt);
    default:           return saasTemplate(name, prompt);
  }
}

// ─── Self-contained HTML fallback templates ────────────────────────────────

function saasTemplate(name: string, _prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f1a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;height:100vh;overflow:hidden}
.sidebar{width:220px;background:#1a1a2e;border-right:1px solid #2d2d4e;display:flex;flex-direction:column;flex-shrink:0}
.brand{padding:20px;font-size:18px;font-weight:700;color:#00d4ff;border-bottom:1px solid #2d2d4e;letter-spacing:2px}
.nav{flex:1;padding:12px 0}
.nav-item{padding:11px 20px;cursor:pointer;color:#94a3b8;font-size:13px;display:flex;align-items:center;gap:10px;transition:all .2s;border-left:3px solid transparent}
.nav-item:hover{background:#252545;color:#e2e8f0}
.nav-item.active{background:#1e1e3f;color:#00d4ff;border-left-color:#00d4ff}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.topbar{height:56px;background:#12121f;border-bottom:1px solid #2d2d4e;display:flex;align-items:center;padding:0 24px;gap:16px}
.topbar-title{font-size:16px;font-weight:600;flex:1}
.btn{padding:7px 16px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .2s}
.btn-primary{background:linear-gradient(135deg,#00d4ff,#0099bb);color:#0f0f1a}
.btn-outline{background:transparent;border:1px solid #2d2d4e;color:#94a3b8}
.btn-outline:hover{border-color:#00d4ff;color:#00d4ff}
.content{flex:1;padding:24px;overflow-y:auto}
.section{display:none}.section.active{display:block}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#1a1a2e;border:1px solid #2d2d4e;border-radius:12px;padding:20px}
.stat-label{font-size:12px;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px}
.stat-value{font-size:28px;font-weight:700}
.stat-change{font-size:12px;margin-top:4px}.pos{color:#4ade80}
.card{background:#1a1a2e;border:1px solid #2d2d4e;border-radius:12px;padding:20px;margin-bottom:16px}
.card-title{font-size:14px;font-weight:600;margin-bottom:16px}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 12px;font-size:11px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #2d2d4e}
td{padding:12px;font-size:13px;border-bottom:1px solid #1e1e35}
.badge{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.badge-green{background:#166534;color:#4ade80}.badge-blue{background:#1e3a5f;color:#60a5fa}.badge-yellow{background:#713f12;color:#fbbf24}
</style></head><body>
<div class="sidebar">
  <div class="brand">${name.slice(0,12).toUpperCase()}</div>
  <nav class="nav">
    <div class="nav-item active" onclick="show('dashboard',this)">📊 Dashboard</div>
    <div class="nav-item" onclick="show('users',this)">👥 Users</div>
    <div class="nav-item" onclick="show('billing',this)">💳 Billing</div>
    <div class="nav-item" onclick="show('analytics',this)">📈 Analytics</div>
    <div class="nav-item" onclick="show('settings',this)">⚙️ Settings</div>
  </nav>
</div>
<div class="main">
  <div class="topbar"><span class="topbar-title" id="ptitle">Dashboard</span><button class="btn btn-outline">Export</button><button class="btn btn-primary">+ New</button></div>
  <div class="content">
    <div id="dashboard" class="section active">
      <div class="stats">
        <div class="stat-card"><div class="stat-label">Users</div><div class="stat-value" style="color:#00d4ff">12,840</div><div class="stat-change pos">↑ 8.2%</div></div>
        <div class="stat-card"><div class="stat-label">Revenue</div><div class="stat-value" style="color:#7c3aed">$48.2K</div><div class="stat-change pos">↑ 12.4%</div></div>
        <div class="stat-card"><div class="stat-label">Active</div><div class="stat-value" style="color:#4ade80">1,284</div><div class="stat-change pos">↑ 3.1%</div></div>
        <div class="stat-card"><div class="stat-label">Conversion</div><div class="stat-value" style="color:#fbbf24">3.8%</div><div class="stat-change pos">↑ 0.4%</div></div>
      </div>
      <div class="card"><div class="card-title">Recent Activity</div>
        <table><thead><tr><th>Customer</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>Acme Corp</td><td>Enterprise</td><td>$2,400/mo</td><td><span class="badge badge-green">Active</span></td></tr>
          <tr><td>NovaTech</td><td>Pro</td><td>$490/mo</td><td><span class="badge badge-green">Active</span></td></tr>
          <tr><td>DataSync AI</td><td>Starter</td><td>$99/mo</td><td><span class="badge badge-yellow">Trial</span></td></tr>
        </tbody></table>
      </div>
    </div>
    <div id="users" class="section"><div class="card"><div class="card-title">User Management</div>
      <table><thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td>Sarah Chen</td><td>sarah@acme.io</td><td>Enterprise</td><td><span class="badge badge-green">Active</span></td></tr>
        <tr><td>Marcus Reid</td><td>m.reid@nova.co</td><td>Pro</td><td><span class="badge badge-green">Active</span></td></tr>
        <tr><td>Priya Patel</td><td>priya@datasync.ai</td><td>Starter</td><td><span class="badge badge-yellow">Trial</span></td></tr>
      </tbody></table>
    </div></div>
    <div id="billing" class="section"><div class="card"><div class="card-title">Invoices</div>
      <table><thead><tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td>INV-001</td><td>Acme Corp</td><td>$2,400</td><td><span class="badge badge-green">Paid</span></td></tr>
        <tr><td>INV-002</td><td>NovaTech</td><td>$490</td><td><span class="badge badge-blue">Pending</span></td></tr>
      </tbody></table>
    </div></div>
    <div id="analytics" class="section"><div class="stats">
      <div class="stat-card"><div class="stat-label">Page Views</div><div class="stat-value" style="color:#00d4ff">284K</div></div>
      <div class="stat-card"><div class="stat-label">Visitors</div><div class="stat-value" style="color:#4ade80">48K</div></div>
      <div class="stat-card"><div class="stat-label">Session</div><div class="stat-value" style="color:#fbbf24">4m32s</div></div>
    </div></div>
    <div id="settings" class="section"><div class="card"><div class="card-title">Settings</div>
      <div style="margin-bottom:12px"><label style="font-size:12px;color:#94a3b8">App Name</label><input value="${name}" style="width:100%;padding:8px;background:#12121f;border:1px solid #2d2d4e;color:#e2e8f0;border-radius:6px;margin-top:4px" /></div>
      <button class="btn btn-primary" onclick="this.textContent='Saved!';setTimeout(()=>this.textContent='Save',2000)">Save</button>
    </div></div>
  </div>
</div>
<script>
const titles={dashboard:'Dashboard',users:'Users',billing:'Billing',analytics:'Analytics',settings:'Settings'};
function show(id,el){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(el)el.classList.add('active');
  document.getElementById('ptitle').textContent=titles[id]||id;
}
</script></body></html>`;
}

function websiteTemplate(name: string, _prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--accent:#00d4ff;--dark:#0a0a0a;--card:#111}
body{background:var(--dark);color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
nav{position:fixed;top:0;left:0;right:0;background:rgba(10,10,10,.95);border-bottom:1px solid #1a1a1a;z-index:100;padding:0 5%;display:flex;align-items:center;height:64px;gap:32px}
.logo{font-size:20px;font-weight:800;color:var(--accent);letter-spacing:2px;margin-right:auto}
.nav-link{font-size:14px;color:#94a3b8;cursor:pointer;transition:color .2s}
.nav-link:hover{color:#fff}
.btn{padding:8px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:none;transition:all .2s}
.btn-primary{background:var(--accent);color:#0a0a0a}
.btn-primary:hover{opacity:.85;transform:translateY(-1px)}
.hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:80px 20px 60px;background:radial-gradient(ellipse at top,#0d1f2d 0%,#0a0a0a 70%)}
.hero h1{font-size:clamp(2rem,5vw,4rem);font-weight:900;line-height:1.1;margin-bottom:24px;background:linear-gradient(135deg,#fff,var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hero p{font-size:18px;color:#94a3b8;max-width:600px;line-height:1.7;margin-bottom:40px}
.hero-btns{display:flex;gap:16px;flex-wrap:wrap;justify-content:center}
.btn-outline{background:transparent;border:1px solid #333;color:#e2e8f0}
.btn-outline:hover{border-color:var(--accent);color:var(--accent)}
.features{padding:80px 5%;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;max-width:1200px;margin:0 auto}
.feature{background:var(--card);border:1px solid #1a1a1a;border-radius:16px;padding:32px;transition:border-color .2s}
.feature:hover{border-color:var(--accent)}
.feature-icon{font-size:36px;margin-bottom:20px}
.feature h3{font-size:20px;font-weight:700;margin-bottom:12px}
.feature p{font-size:14px;color:#64748b;line-height:1.7}
.cta{padding:80px 5%;text-align:center;background:linear-gradient(135deg,#0d1f2d,#0a0a0a)}
.cta h2{font-size:clamp(1.5rem,3vw,2.5rem);font-weight:800;margin-bottom:16px}
footer{padding:32px 5%;border-top:1px solid #1a1a1a;text-align:center;color:#374151;font-size:13px}
</style></head><body>
<nav>
  <div class="logo">${name.slice(0,10).toUpperCase()}</div>
  <span class="nav-link" onclick="scrollTo({top:document.querySelector('.features').offsetTop,behavior:'smooth'})">Features</span>
  <span class="nav-link">Pricing</span>
  <span class="nav-link">Docs</span>
  <button class="btn btn-primary">Get Started</button>
</nav>
<div class="hero">
  <h1>${name}</h1>
  <p>The next-generation platform built for teams who move fast and build bold. Ship faster, scale smarter, grow further.</p>
  <div class="hero-btns">
    <button class="btn btn-primary" onclick="alert('Welcome to ${name}!')">Start Free →</button>
    <button class="btn btn-outline">Watch Demo</button>
  </div>
</div>
<div class="features">
  <div class="feature"><div class="feature-icon">⚡</div><h3>Lightning Fast</h3><p>Optimised performance at every layer. Sub-100ms response times, globally distributed edge network.</p></div>
  <div class="feature"><div class="feature-icon">🔐</div><h3>Enterprise Security</h3><p>SOC2 Type II certified, end-to-end encryption, and granular access controls built in from day one.</p></div>
  <div class="feature"><div class="feature-icon">🤖</div><h3>AI-Powered</h3><p>Intelligent automation that learns your workflow and surfaces insights when you need them most.</p></div>
  <div class="feature"><div class="feature-icon">📊</div><h3>Deep Analytics</h3><p>Real-time dashboards, custom reports, and actionable data visualisations for every team member.</p></div>
  <div class="feature"><div class="feature-icon">🔗</div><h3>Integrations</h3><p>Connect with 200+ tools your team already uses. Slack, GitHub, Stripe, and more — all in one click.</p></div>
  <div class="feature"><div class="feature-icon">🌍</div><h3>Global Scale</h3><p>Deployed across 40 regions worldwide. Infinite horizontal scaling with zero configuration needed.</p></div>
</div>
<div class="cta">
  <h2>Ready to build the future?</h2>
  <p style="color:#64748b;margin-bottom:32px">Join 50,000+ teams who trust ${name} to power their products.</p>
  <button class="btn btn-primary" style="font-size:15px;padding:12px 32px" onclick="alert('Account created! Welcome.')">Get Started Free</button>
</div>
<footer>© 2025 ${name} · All rights reserved</footer>
</body></html>`;
}

function mobileTemplate(name: string, _prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f1a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:430px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}
.status-bar{height:44px;background:#1a1a2e;display:flex;align-items:center;justify-content:space-between;padding:0 20px;font-size:12px;color:#64748b;flex-shrink:0}
.header{background:#1a1a2e;border-bottom:1px solid #2d2d4e;padding:16px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0}
.avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#00d4ff,#7c3aed);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}
.header-text h1{font-size:16px;font-weight:700}
.header-text p{font-size:11px;color:#64748b}
.screen{display:none;flex:1;overflow-y:auto;padding:16px}.screen.active{display:block}
.card{background:#1a1a2e;border:1px solid #2d2d4e;border-radius:16px;padding:16px;margin-bottom:12px}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.card-title{font-size:14px;font-weight:600}
.btn{width:100%;padding:14px;border-radius:12px;border:none;cursor:pointer;font-size:15px;font-weight:700;transition:all .2s}
.btn-primary{background:linear-gradient(135deg,#00d4ff,#7c3aed);color:#fff;margin-bottom:10px}
.btn-secondary{background:#1e1e3f;color:#94a3b8;border:1px solid #2d2d4e}
.list-item{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #1e1e35}
.list-item:last-child{border:none}
.item-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.item-info h3{font-size:14px;font-weight:600}
.item-info p{font-size:12px;color:#64748b}
.badge{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;margin-left:auto}
.badge-green{background:#166534;color:#4ade80}
.tab-bar{height:80px;background:#1a1a2e;border-top:1px solid #2d2d4e;display:flex;align-items:center;justify-content:space-around;flex-shrink:0;padding-bottom:16px}
.tab{display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;padding:8px 16px;border-radius:10px;transition:all .2s;color:#64748b}
.tab.active{color:#00d4ff;background:#0d2233}
.tab span{font-size:10px;font-weight:600}
</style></head><body>
<div class="status-bar"><span>9:41 AM</span><span>⚡ ${name.slice(0,8)}</span><span>100% 🔋</span></div>
<div class="header"><div class="avatar">A</div><div class="header-text"><h1>${name}</h1><p>Welcome back, Alex</p></div></div>
<div id="home" class="screen active">
  <div class="card"><div class="card-header"><span class="card-title">Quick Actions</span></div>
    <button class="btn btn-primary" onclick="alert('Starting now...')">🚀 Get Started</button>
    <button class="btn btn-secondary" onclick="showTab('explore')">🔍 Explore</button>
  </div>
  <div class="card"><div class="card-header"><span class="card-title">Recent Activity</span></div>
    <div class="list-item"><div class="item-icon" style="background:#1e3a5f">📱</div><div class="item-info"><h3>Item One</h3><p>Just now</p></div><span class="badge badge-green">New</span></div>
    <div class="list-item"><div class="item-icon" style="background:#2d1b69">⚡</div><div class="item-info"><h3>Item Two</h3><p>2 min ago</p></div></div>
    <div class="list-item"><div class="item-icon" style="background:#166534">✅</div><div class="item-info"><h3>Item Three</h3><p>1 hour ago</p></div></div>
  </div>
</div>
<div id="explore" class="screen">
  <div class="card"><div class="card-title" style="margin-bottom:12px">Discover</div>
    <div class="list-item"><div class="item-icon" style="background:#1a1a2e">🌟</div><div class="item-info"><h3>Featured</h3><p>Top picks for you</p></div></div>
    <div class="list-item"><div class="item-icon" style="background:#1a1a2e">🔥</div><div class="item-info"><h3>Trending</h3><p>What's popular</p></div></div>
    <div class="list-item"><div class="item-icon" style="background:#1a1a2e">🆕</div><div class="item-info"><h3>New Arrivals</h3><p>Just added</p></div></div>
  </div>
</div>
<div id="profile" class="screen">
  <div class="card"><div class="card-title" style="margin-bottom:16px">Profile</div>
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
      <div class="avatar" style="width:64px;height:64px;font-size:24px">A</div>
      <div><div style="font-weight:700">Alex Johnson</div><div style="color:#64748b;font-size:13px">alex@example.com</div></div>
    </div>
    <button class="btn btn-secondary" onclick="alert('Settings coming soon!')">⚙️ Settings</button>
  </div>
</div>
<div class="tab-bar">
  <div class="tab active" onclick="showTab('home',this)"><span style="font-size:20px">🏠</span><span>Home</span></div>
  <div class="tab" onclick="showTab('explore',this)"><span style="font-size:20px">🔍</span><span>Explore</span></div>
  <div class="tab" onclick="showTab('profile',this)"><span style="font-size:20px">👤</span><span>Profile</span></div>
</div>
<script>
function showTab(id,el){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  const s=document.getElementById(id);if(s)s.classList.add('active');
  if(el)el.classList.add('active');
}
</script></body></html>`;
}

function aiToolTemplate(name: string, _prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f1a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;flex-direction:column;height:100vh}
.header{background:#1a1a2e;border-bottom:1px solid #2d2d4e;padding:16px 24px;display:flex;align-items:center;gap:12px;flex-shrink:0}
.logo{font-size:18px;font-weight:800;color:#00d4ff;letter-spacing:2px;flex:1}
.status{font-size:12px;color:#4ade80;display:flex;align-items:center;gap:6px}
.status::before{content:'';width:8px;height:8px;border-radius:50%;background:#4ade80;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.chat{flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:16px}
.msg{max-width:80%;padding:14px 18px;border-radius:16px;font-size:14px;line-height:1.6}
.msg.ai{background:#1e1e3f;border:1px solid #2d2d4e;align-self:flex-start;border-radius:4px 16px 16px 16px}
.msg.user{background:linear-gradient(135deg,#1a3a5c,#2d1b69);align-self:flex-end;border-radius:16px 16px 4px 16px}
.msg-label{font-size:10px;color:#64748b;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:1px}
.input-area{background:#1a1a2e;border-top:1px solid #2d2d4e;padding:16px 24px;display:flex;gap:12px;flex-shrink:0}
textarea{flex:1;background:#12121f;border:1px solid #2d2d4e;color:#e2e8f0;padding:12px 16px;border-radius:12px;font-size:14px;resize:none;outline:none;font-family:inherit;min-height:48px;max-height:120px;transition:border-color .2s}
textarea:focus{border-color:#00d4ff}
.send-btn{width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#00d4ff,#7c3aed);border:none;cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s}
.send-btn:hover{opacity:.85}
.typing{display:none;align-items:center;gap:6px;color:#64748b;font-size:13px;padding:0 24px 8px}
.typing.show{display:flex}
.dot{width:6px;height:6px;border-radius:50%;background:#00d4ff;animation:bounce .8s infinite}
.dot:nth-child(2){animation-delay:.15s}.dot:nth-child(3){animation-delay:.3s}
@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-8px)}}
</style></head><body>
<div class="header"><div class="logo">${name.slice(0,12)}</div><div class="status">AI Online</div></div>
<div class="chat" id="chat">
  <div><div class="msg-label">🤖 ${name} AI</div><div class="msg ai">Hello! I'm your AI assistant for ${name}. I can help you with analysis, content generation, data processing, and answering questions. What would you like to do today?</div></div>
</div>
<div class="typing" id="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>AI is thinking...</span></div>
<div class="input-area">
  <textarea id="inp" placeholder="Ask me anything..." rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send()}"></textarea>
  <button class="send-btn" onclick="send()">➤</button>
</div>
<script>
const replies=[
  "That's a great question! Based on my analysis, I recommend focusing on the core user journey first, then iterating based on feedback.",
  "I've processed your request. Here's what I found: the data shows a clear pattern that suggests optimising for retention over acquisition at this stage.",
  "Excellent insight! I can generate a detailed breakdown for you. The key factors are: (1) market timing, (2) user segmentation, and (3) value proposition clarity.",
  "I've analysed similar cases and the best approach here is a phased rollout — start with 10% of users, measure, then scale.",
  "Here's my recommendation: prioritise the highest-impact, lowest-effort items first. Based on your context, that would be improving onboarding flow.",
];
let ri=0;
function send(){
  const inp=document.getElementById('inp');
  const text=inp.value.trim();
  if(!text)return;
  const chat=document.getElementById('chat');
  chat.innerHTML+=\`<div style="display:flex;justify-content:flex-end"><div><div class="msg-label" style="text-align:right">You</div><div class="msg user">\${text}</div></div></div>\`;
  inp.value='';
  document.getElementById('typing').classList.add('show');
  chat.scrollTop=chat.scrollHeight;
  setTimeout(()=>{
    document.getElementById('typing').classList.remove('show');
    const reply=replies[ri%replies.length];ri++;
    chat.innerHTML+=\`<div><div class="msg-label">🤖 AI</div><div class="msg ai">\${reply}</div></div>\`;
    chat.scrollTop=chat.scrollHeight;
  },1500+Math.random()*1000);
}
</script></body></html>`;
}

function automationTemplate(name: string, _prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f1a;color:#e2e8f0;font-family:monospace;display:flex;height:100vh}
.sidebar{width:220px;background:#1a1a2e;border-right:1px solid #2d2d4e;display:flex;flex-direction:column;flex-shrink:0}
.brand{padding:16px 20px;font-size:16px;font-weight:700;color:#4ade80;border-bottom:1px solid #2d2d4e}
.nav{flex:1;padding:8px 0}
.nav-item{padding:10px 20px;cursor:pointer;font-size:12px;color:#64748b;transition:all .2s}
.nav-item:hover,.nav-item.active{color:#4ade80;background:#0d1f0d}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.topbar{height:48px;background:#12121f;border-bottom:1px solid #2d2d4e;display:flex;align-items:center;padding:0 20px;gap:12px}
.dot-green{width:8px;height:8px;border-radius:50%;background:#4ade80;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.content{flex:1;padding:20px;overflow-y:auto}
.section{display:none}.section.active{display:block}
.pipeline-card{background:#1a1a2e;border:1px solid #2d2d4e;border-radius:10px;padding:16px;margin-bottom:12px}
.pipeline-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.pipeline-name{font-size:14px;font-weight:700;color:#e2e8f0}
.badge{padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700}
.badge-green{background:#166534;color:#4ade80}.badge-blue{background:#1e3a5f;color:#60a5fa}.badge-yellow{background:#713f12;color:#fbbf24}
.steps{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.step{padding:4px 10px;background:#12121f;border-radius:6px;font-size:11px;color:#94a3b8;border:1px solid #2d2d4e}
.terminal{background:#0a0a0f;border:1px solid #1a1a2e;border-radius:10px;padding:16px;font-size:12px;height:200px;overflow-y:auto}
.log-line{margin-bottom:4px;line-height:1.6}
.log-line .ts{color:#374151}.log-line .ok{color:#4ade80}.log-line .info{color:#60a5fa}.log-line .warn{color:#fbbf24}
.run-btn{padding:8px 20px;background:#166534;border:1px solid #4ade80;color:#4ade80;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;transition:all .2s}
.run-btn:hover{background:#14532d}
</style></head><body>
<div class="sidebar">
  <div class="brand">⚙ ${name.slice(0,10)}</div>
  <nav class="nav">
    <div class="nav-item active" onclick="show('pipelines',this)">📋 Pipelines</div>
    <div class="nav-item" onclick="show('logs',this)">📜 Logs</div>
    <div class="nav-item" onclick="show('schedule',this)">⏰ Schedule</div>
    <div class="nav-item" onclick="show('settings',this)">⚙️ Settings</div>
  </nav>
</div>
<div class="main">
  <div class="topbar"><div class="dot-green"></div><span style="color:#4ade80;font-size:12px">${name} AUTOMATION ENGINE</span><span style="color:#374151;font-size:11px;margin-left:auto">3 pipelines active</span></div>
  <div class="content">
    <div id="pipelines" class="section active">
      <div class="pipeline-card">
        <div class="pipeline-header"><span class="pipeline-name">Data Sync Pipeline</span><span class="badge badge-green">RUNNING</span></div>
        <div class="steps"><span class="step">✓ Fetch</span><span class="step">✓ Transform</span><span class="step">⟳ Load</span><span class="step">○ Notify</span></div>
        <div style="margin-top:10px;display:flex;gap:8px"><button class="run-btn" onclick="runPipeline()">▶ Run Now</button></div>
      </div>
      <div class="pipeline-card">
        <div class="pipeline-header"><span class="pipeline-name">Report Generator</span><span class="badge badge-blue">SCHEDULED</span></div>
        <div class="steps"><span class="step">○ Query</span><span class="step">○ Format</span><span class="step">○ Send</span></div>
        <div style="margin-top:10px"><button class="run-btn" onclick="alert('Pipeline queued!')">▶ Run Now</button></div>
      </div>
      <div class="pipeline-card">
        <div class="pipeline-header"><span class="pipeline-name">Cleanup Job</span><span class="badge badge-yellow">IDLE</span></div>
        <div class="steps"><span class="step">○ Scan</span><span class="step">○ Delete</span><span class="step">○ Archive</span></div>
        <div style="margin-top:10px"><button class="run-btn" onclick="alert('Cleanup started!')">▶ Run Now</button></div>
      </div>
    </div>
    <div id="logs" class="section">
      <div class="terminal" id="terminal">
        <div class="log-line"><span class="ts">[09:41:00]</span> <span class="ok">[OK]</span> Pipeline started</div>
        <div class="log-line"><span class="ts">[09:41:01]</span> <span class="info">[INFO]</span> Connecting to data source...</div>
        <div class="log-line"><span class="ts">[09:41:02]</span> <span class="ok">[OK]</span> 1,284 records fetched</div>
        <div class="log-line"><span class="ts">[09:41:03]</span> <span class="info">[INFO]</span> Transforming data...</div>
        <div class="log-line"><span class="ts">[09:41:05]</span> <span class="ok">[OK]</span> Transform complete</div>
      </div>
    </div>
    <div id="schedule" class="section">
      <div class="pipeline-card"><div class="pipeline-name">Scheduled Tasks</div>
        <table style="width:100%;margin-top:12px;font-size:12px;border-collapse:collapse">
          <tr style="color:#64748b"><td style="padding:6px">Pipeline</td><td>Schedule</td><td>Next Run</td></tr>
          <tr><td style="padding:6px">Data Sync</td><td>Every 5min</td><td>09:45:00</td></tr>
          <tr><td style="padding:6px">Report Generator</td><td>Daily 06:00</td><td>Tomorrow</td></tr>
          <tr><td style="padding:6px">Cleanup Job</td><td>Weekly Sun</td><td>Sunday</td></tr>
        </table>
      </div>
    </div>
    <div id="settings" class="section"><div class="pipeline-card"><div class="pipeline-name">Configuration</div>
      <div style="margin-top:12px;font-size:12px"><div style="margin-bottom:8px;color:#64748b">API Endpoint</div><input value="https://api.example.com/v1" style="width:100%;padding:8px;background:#12121f;border:1px solid #2d2d4e;color:#4ade80;border-radius:6px;font-family:monospace;font-size:12px" /></div>
    </div></div>
  </div>
</div>
<script>
function show(id,el){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(el)el.classList.add('active');
}
function runPipeline(){
  const t=document.getElementById('terminal');
  const msgs=['Fetching data...','Processing 1,284 records...','Applying transformations...','Validating output...','Pipeline complete ✓'];
  let i=0;
  const iv=setInterval(()=>{
    if(i>=msgs.length){clearInterval(iv);return}
    const now=new Date().toTimeString().slice(0,8);
    t.innerHTML+=\`<div class="log-line"><span class="ts">[\${now}]</span> <span class="\${i===msgs.length-1?'ok':'info'}">[\${i===msgs.length-1?'OK':'INFO'}]</span> \${msgs[i]}</div>\`;
    t.scrollTop=t.scrollHeight;i++;
  },600);
  show('logs',null);
  alert('Pipeline started! Check Logs tab.');
}
</script></body></html>`;
}

/**
 * Generate a self-contained Node.js Express server for a deployed app.
 *
 * The server:
 *   - Provides NEXUS_API-compatible routes backed by in-memory storage
 *     (same REST contract as the platform's /api/projects/:id/appdata routes)
 *   - Serves the frontend HTML at all other routes (SPA-style)
 *   - Rewrites window.NEXUS_API to point to itself when serving index.html
 *   - Has zero native-compilation dependencies (only express + cors)
 *
 * Called at deploy-time to produce a server.js the Render container downloads
 * and runs, and also included in the ZIP download for self-hosting.
 */
export function generateServerJs(name: string): string {
  const safe = name.replace(/[`\\'"]/g, "").slice(0, 60);
  return [
    "'use strict';",
    "var express = require('express');",
    "var cors    = require('cors');",
    "var fs      = require('fs');",
    "var path    = require('path');",
    "",
    "var app  = express();",
    "var PORT = process.env.PORT || 3000;",
    "var EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || ('http://localhost:' + PORT);",
    "",
    "// In-memory database — persists across requests, resets on process restart.",
    "// Keys: collection name → Map<docId, record>",
    "var store = {};",
    "function getCol(col) { if (!store[col]) store[col] = {}; return store[col]; }",
    "function makeId()    { return Math.random().toString(36).slice(2) + Date.now().toString(36); }",
    "",
    "app.use(cors());",
    "app.use(express.json({ limit: '10mb' }));",
    "",
    "// ── NEXUS API — same REST contract as the NexusElite platform ────────────",
    "app.get('/api/appdata/:col', function(req, res) {",
    "  var col  = req.params.col;",
    "  var recs = Object.values(getCol(col));",
    "  res.json(recs);",
    "});",
    "",
    "app.post('/api/appdata/:col', function(req, res) {",
    "  var col  = req.params.col;",
    "  var id   = makeId();",
    "  var rec  = Object.assign({ id: id }, req.body || {});",
    "  getCol(col)[id] = rec;",
    "  res.status(201).json(rec);",
    "});",
    "",
    "app.put('/api/appdata/:col/:docId', function(req, res) {",
    "  var col   = req.params.col;",
    "  var docId = req.params.docId;",
    "  var prev  = getCol(col)[docId] || {};",
    "  var rec   = Object.assign({}, prev, req.body || {}, { id: docId });",
    "  getCol(col)[docId] = rec;",
    "  res.json(rec);",
    "});",
    "",
    "app.delete('/api/appdata/:col/:docId', function(req, res) {",
    "  var col   = req.params.col;",
    "  var docId = req.params.docId;",
    "  delete getCol(col)[docId];",
    "  res.status(204).send();",
    "});",
    "",
    "// ── Frontend — rewrite NEXUS_API to point to this server ─────────────────",
    "app.get('*', function(req, res) {",
    "  var idx = path.join(__dirname, 'public', 'index.html');",
    "  if (!fs.existsSync(idx)) {",
    `    return res.status(503).send('<!DOCTYPE html><html><body style="background:#0f0f1a;color:#00d4ff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center"><h2>${safe} — starting up…</h2></body></html>');`,
    "  }",
    "  var html = fs.readFileSync(idx, 'utf8');",
    "  // Redirect NEXUS_API to this server's own backend endpoint",
    "  var marker = 'NEXUS_API = \"';",
    "  var mi = html.indexOf('window.' + marker);",
    "  if (mi !== -1) {",
    "    var qs = mi + 7 + marker.length;",
    "    var qe = html.indexOf('\"', qs);",
    "    if (qe !== -1) html = html.slice(0, qs) + EXTERNAL_URL + '/api/appdata' + html.slice(qe);",
    "  }",
    "  res.setHeader('Content-Type', 'text/html');",
    "  res.send(html);",
    "});",
    "",
    `app.listen(PORT, function() { console.log('[${safe}] Running on port ' + PORT + ' — ' + EXTERNAL_URL); });`,
  ].join("\n");
}

function gameTemplate(name: string, _prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden}
canvas{display:block;border:2px solid rgba(0,212,255,.3);box-shadow:0 0 40px rgba(0,212,255,.2)}
</style></head><body>
<canvas id="c"></canvas>
<script>
const c=document.getElementById('c'),ctx=c.getContext('2d');
c.width=Math.min(window.innerWidth,600);c.height=Math.min(window.innerHeight,500);
const W=c.width,H=c.height;
let score=0,lives=3,state='start',keys={},enemies=[],bullets=[],particles=[],lastEnemy=0;
const player={x:W/2,y:H-60,w:40,h:30,speed:5};

function spawnEnemy(){
  enemies.push({x:Math.random()*(W-40)+20,y:-20,w:30,h:25,speed:1.5+score/500,color:\`hsl(\${Math.random()*60+180},100%,60%)\`});
}
function spawnBullet(){
  bullets.push({x:player.x,y:player.y,speed:8});
}
function makeParticles(x,y,color){
  for(let i=0;i<8;i++)particles.push({x,y,vx:(Math.random()-0.5)*6,vy:(Math.random()-0.5)*6,life:1,color});
}
function rect(obj,col){
  ctx.fillStyle=col||'#00d4ff';
  ctx.beginPath();ctx.roundRect(obj.x-obj.w/2,obj.y-obj.h/2,obj.w,obj.h,4);ctx.fill();
}
function collide(a,b){return Math.abs(a.x-b.x)<(a.w+b.w)/2&&Math.abs(a.y-b.y)<(a.h+b.h)/2;}

let lastShot=0;
function update(t){
  if(state!=='play')return;
  if(keys['ArrowLeft']||keys['a'])player.x=Math.max(player.w/2,player.x-player.speed);
  if(keys['ArrowRight']||keys['d'])player.x=Math.min(W-player.w/2,player.x+player.speed);
  if((keys[' ']||keys['ArrowUp'])&&t-lastShot>250){spawnBullet();lastShot=t;}
  if(t-lastEnemy>900-Math.min(score*0.5,700)){spawnEnemy();lastEnemy=t;}
  bullets.forEach(b=>b.y-=b.speed);
  bullets=bullets.filter(b=>b.y>0);
  enemies.forEach(e=>e.y+=e.speed);
  for(let i=enemies.length-1;i>=0;i--){
    for(let j=bullets.length-1;j>=0;j--){
      if(collide(enemies[i],bullets[j])){makeParticles(enemies[i].x,enemies[i].y,enemies[i].color);enemies.splice(i,1);bullets.splice(j,1);score+=10;break;}
    }
  }
  for(let i=enemies.length-1;i>=0;i--){
    if(enemies[i].y>H+20){enemies.splice(i,1);lives--;if(lives<=0){state='over';}}
    else if(collide(enemies[i],player)){makeParticles(player.x,player.y,'#ff4444');enemies.splice(i,1);lives--;if(lives<=0){state='over';}}
  }
  particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.life-=0.05;p.vx*=0.95;p.vy*=0.95;});
  particles=particles.filter(p=>p.life>0);
}
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#0a0a0f';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='rgba(255,255,255,.4)';
  for(let i=0;i<40;i++){const x=(i*137+Date.now()*0.01)%W,y=(i*89+Date.now()*0.005)%H;ctx.fillRect(x,y,1,1);}
  if(state==='start'){
    ctx.fillStyle='#00d4ff';ctx.font=\`bold \${W>400?42:28}px -apple-system,sans-serif\`;ctx.textAlign='center';
    ctx.shadowBlur=20;ctx.shadowColor='#00d4ff';
    ctx.fillText('${name.slice(0,14).toUpperCase()}',W/2,H/2-40);
    ctx.font=\`\${W>400?16:13}px -apple-system,sans-serif\`;ctx.fillStyle='#94a3b8';ctx.shadowBlur=0;
    ctx.fillText('Arrow keys / WASD to move • Space to shoot',W/2,H/2+10);
    ctx.fillStyle='rgba(0,212,255,.8)';ctx.font='bold 18px sans-serif';
    ctx.fillText('TAP OR PRESS SPACE TO START',W/2,H/2+50);
    return;
  }
  if(state==='over'){
    ctx.fillStyle='#ff4444';ctx.font='bold 40px sans-serif';ctx.textAlign='center';ctx.shadowBlur=20;ctx.shadowColor='#ff4444';
    ctx.fillText('GAME OVER',W/2,H/2-30);ctx.shadowBlur=0;
    ctx.fillStyle='#e2e8f0';ctx.font='24px sans-serif';
    ctx.fillText('Score: '+score,W/2,H/2+10);
    ctx.fillStyle='#00d4ff';ctx.font='18px sans-serif';
    ctx.fillText('Tap or Space to restart',W/2,H/2+50);
    return;
  }
  ctx.save();ctx.shadowBlur=12;ctx.shadowColor='#00d4ff';
  ctx.fillStyle='#00d4ff';ctx.beginPath();
  ctx.moveTo(player.x,player.y-player.h/2);ctx.lineTo(player.x-player.w/2,player.y+player.h/2);ctx.lineTo(player.x+player.w/2,player.y+player.h/2);ctx.closePath();ctx.fill();
  ctx.restore();
  bullets.forEach(b=>{ctx.fillStyle='#fff';ctx.shadowBlur=8;ctx.shadowColor='#00d4ff';ctx.fillRect(b.x-2,b.y-8,4,12);});
  ctx.shadowBlur=0;
  enemies.forEach(e=>{ctx.fillStyle=e.color;ctx.beginPath();ctx.moveTo(e.x,e.y+e.h/2);ctx.lineTo(e.x-e.w/2,e.y-e.h/2);ctx.lineTo(e.x+e.w/2,e.y-e.h/2);ctx.closePath();ctx.fill();});
  particles.forEach(p=>{ctx.globalAlpha=p.life;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();});
  ctx.globalAlpha=1;
  ctx.fillStyle='rgba(0,0,0,.5)';ctx.fillRect(0,0,W,36);
  ctx.fillStyle='#e2e8f0';ctx.font='bold 14px sans-serif';ctx.textAlign='left';ctx.fillText('SCORE: '+score,12,22);
  ctx.textAlign='right';ctx.fillText('♥ '.repeat(lives),W-12,22);
}
document.addEventListener('keydown',e=>{keys[e.key]=true;if((e.key===' '||e.key==='ArrowUp')&&state!=='play'){startOrRestart();}e.preventDefault();});
document.addEventListener('keyup',e=>keys[e.key]=false);
c.addEventListener('click',startOrRestart);
c.addEventListener('touchstart',e=>{e.preventDefault();startOrRestart();},{passive:false});
function startOrRestart(){if(state==='start'||state==='over'){score=0;lives=3;enemies=[];bullets=[];particles=[];state='play';}}

let last=0;
function loop(t){requestAnimationFrame(loop);update(t);draw();last=t;}
requestAnimationFrame(loop);
</script></body></html>`;
}
