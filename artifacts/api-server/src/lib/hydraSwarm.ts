/**
 * HYDRA-PRIME SWARM v4 — TypeScript Edition
 * Hierarchical, self-replicating, cost-optimized AI swarm.
 *
 * Integrates with NexusElite's existing OpenRouter SDK (chatViaSdk)
 * so all calls appear in the Command Center → Telemetry tab.
 *
 * DROP-IN: place at artifacts/api-server/src/lib/hydraSwarm.ts
 */

import { chatViaSdk } from "./openrouterSdk.js";

// ============================================================
// CONFIG
// ============================================================

const MAX_PARALLEL  = 20;   // Node.js concurrent cap (Python had 200 — keep sane)
const MAX_RECURSION = 4;    // fractal sub-swarm depth

// Model tiers — cheap → premium fallback order
// Uses your confirmed-working models first, then HYDRA's extras.
export const MODEL_TIERS: Record<string, string[]> = {
  reasoning: [
    "z-ai/glm-5.1",
    "deepseek/deepseek-chat",
    "moonshotai/kimi-k2.6",
    "minimax/minimax-m2.7",
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4.7",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-flash",
  ],
  coding: [
    "qwen/qwen3-coder",
    "z-ai/glm-5.1",
    "deepseek/deepseek-chat",
    "moonshotai/kimi-k2.6",
    "x-ai/grok-build-0.1",
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-opus-4.7",
    "qwen/qwen3-coder:free",
    "openai/gpt-oss-120b:free",
    "meta-llama/llama-3.3-70b-instruct:free",
  ],
  fast: [
    "z-ai/glm-5.1",
    "google/gemini-2.5-flash",
    "deepseek/deepseek-chat",
    "minimax/minimax-m2.7",
    "anthropic/claude-haiku-4.5",
    "meta-llama/llama-3.3-70b-instruct:free",
  ],
  longctx: [
    "google/gemini-2.5-pro",
    "moonshotai/kimi-k2.6",
    "minimax/minimax-m2.7",
    "anthropic/claude-sonnet-4.6",
    "google/gemini-2.5-flash",
  ],
  critic: [
    "deepseek/deepseek-chat",
    "z-ai/glm-5.1",
    "qwen/qwen3-coder",
    "anthropic/claude-sonnet-4.6",
    "qwen/qwen3-coder:free",
  ],
  creative: [
    "z-ai/glm-5.1",
    "moonshotai/kimi-k2.6",
    "minimax/minimax-m2.7",
    "google/gemini-2.5-pro",
    "anthropic/claude-opus-4.7",
  ],
};

// ============================================================
// SEMAPHORE — cap concurrent API calls in Node.js
// ============================================================

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

const _semaphore  = new Semaphore(MAX_PARALLEL);
const _circuit: Record<string, number> = {}; // model → cooldown_until ms

// ============================================================
// SHARED MEMORY — project-wide blackboard
// ============================================================

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

// ============================================================
// OPENROUTER CALL — fallback chain + circuit breaker
// Uses chatViaSdk so calls appear in devtools / telemetry
// ============================================================

function timeoutForModel(model: string): number {
  if (/opus|sonnet|kimi|minimax|gemini-3\.5|gemini-2\.5-pro/i.test(model)) return 120_000;
  if (model.endsWith(":free"))                                               return  60_000;
  return 60_000;
}

export async function callLlm(
  prompt:    string,
  system     = "You are an elite production-grade engineer.",
  tier       = "coding",
  maxTokens  = 8000,
  temperature = 0.3,
  jsonMode   = false,
  agentName  = "anon",
  mem?:      SharedMemory,
  onLog?:    (msg: string) => void,
): Promise<string> {
  const chain   = MODEL_TIERS[tier] ?? MODEL_TIERS.coding;
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

        const data = await chatViaSdk(body, { timeoutMs: timeoutForModel(model) });
        const content: string = data.choices?.[0]?.message?.content ?? "";

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
        const status: number | undefined =
          err?.statusCode ?? err?.status ?? err?.response?.status;
        const isTimeout =
          err?.name === "AbortError" || /timeout/i.test(err?.message ?? "");
        const retryable = isTimeout || status === 429 || (status !== undefined && status >= 500);

        _circuit[model] = Date.now() + (status === 429 ? 30_000 : 15_000);
        if (!retryable && status !== undefined) continue; // non-retryable — skip
        continue;
      }
    }
  } finally {
    _semaphore.release();
  }

  throw lastErr ?? new Error(`All models failed for tier '${tier}'`);
}

// ============================================================
// JSON + FILE BLOCK HELPERS
// ============================================================

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

// ============================================================
// AGENT BASE CLASS
// ============================================================

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
      "Respond in production-quality, fully implemented code with NO placeholders, " +
      "NO 'TODO', NO 'as needed' comments. Every function fully written. " +
      "When emitting files, format as:\n" +
      "===FILE: relative/path.ext===\n```lang\n<code>\n```\n"
    );
    const prompt = `PROJECT CONTEXT:\n${context}\n\nTASK:\n${task}`;
    const out = await callLlm(
      prompt, system, this.tier, this.maxTokens, this.temperature,
      false, this.name, mem, onLog,
    );
    return { name: this.name, output: out, files: extractCodeFiles(out), meta: {} };
  }
}

// ============================================================
// LAYER 1 — SOVEREIGN (CEO Brain)
// ============================================================

export async function sovereign(
  userPrompt: string,
  mem:        SharedMemory,
  onLog:      (msg: string) => void,
): Promise<Record<string, any>> {
  onLog("\n👑 [SOVEREIGN] Analysing project...");
  const system = (
    "You are SOVEREIGN, the CEO architect. Read the user's request and " +
    "output a JSON master blueprint with keys: project_name, project_type " +
    "(mobile_app|saas|website|business_software|video_game|hybrid), " +
    "platforms[], stack{}, key_features[], target_users, monetization, " +
    "complexity (1-10), estimated_files (int), risks[]."
  );
  const raw = await callLlm(
    userPrompt, system, "reasoning", 4000, 0.4, true, "SOVEREIGN", mem, onLog,
  );
  const bp = extractJson(raw);
  mem.blueprint = bp;
  mem.addDecision(`Project type: ${bp.project_type}, stack: ${JSON.stringify(bp.stack)}`);
  onLog(`👑 [SOVEREIGN] Blueprint: ${bp.project_name} (${bp.project_type})`);
  return bp;
}

// ============================================================
// LAYER 2 — ARCHITECT COUNCIL (5 specialists in parallel)
// ============================================================

const ARCHITECTS: Array<[string, string]> = [
  ["SystemArchitect",   "system architect designing modules, services, and data flow"],
  ["UXArchitect",       "UX/UI architect designing screens, flows, components, design system"],
  ["DataArchitect",     "data architect designing schemas, indexes, migrations, and APIs"],
  ["SecurityArchitect", "security architect designing auth, RBAC, secrets, threat model"],
  ["DevOpsArchitect",   "devops architect designing CI/CD, infra, deploy, monitoring"],
];

export async function architectCouncil(
  blueprint: Record<string, any>,
  mem:       SharedMemory,
  onLog:     (msg: string) => void,
): Promise<Record<string, any>> {
  onLog("\n🏛  [ARCHITECT COUNCIL] Convening...");
  const ctx = JSON.stringify(blueprint, null, 2);

  const results = await Promise.allSettled(
    ARCHITECTS.map(([name, role]) => {
      const a = new HydraAgent(name, role, "reasoning", 0.3, 6000);
      return a.run(
        `Produce your section of the Technical Design Document for this blueprint. ` +
        `Be exhaustive. Output JSON with key '${name}_design'.`,
        ctx, mem, onLog,
      );
    })
  );

  const tdd: Record<string, any> = {};
  for (const r of results) {
    if (r.status === "fulfilled") {
      const merged = extractJson(r.value.output);
      if (merged && typeof merged === "object") Object.assign(tdd, merged);
    }
  }
  mem.tdd = tdd;
  mem.addDecision("TDD finalized by architect council");
  onLog("🏛  [ARCHITECT COUNCIL] TDD complete");
  return tdd;
}

// ============================================================
// LAYER 3 — DEPARTMENT HEADS
// LAYER 4 — FRACTAL WORKER SWARM
// ============================================================

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

interface AtomicTask {
  id:          string;
  title:       string;
  file_hint:   string;
  description: string;
  depends_on?: string[];
}

async function departmentHeadDecompose(
  dept:  string,
  ctx:   string,
  mem:   SharedMemory,
  onLog: (msg: string) => void,
): Promise<AtomicTask[]> {
  const role   = DEPARTMENTS[dept];
  const system = (
    `You are the ${dept} Department Head (${role}). ` +
    "Decompose your domain into 5-15 ATOMIC implementation tasks. " +
    "Each task = one file or one tightly-scoped unit. " +
    `Output JSON: {"tasks": [{"id":"...","title":"...","file_hint":"path","description":"...","depends_on":[]}]}`
  );
  const raw  = await callLlm(ctx, system, "reasoning", 4000, 0.3, true, `${dept}-Head`, mem, onLog);
  const data = extractJson(raw);
  return Array.isArray(data?.tasks) ? data.tasks : [];
}

async function workerExecute(
  task:  AtomicTask,
  dept:  string,
  ctx:   string,
  depth: number,
  mem:   SharedMemory,
  onLog: (msg: string) => void,
): Promise<AgentResult> {
  const desc = task.description ?? "";

  // FRACTAL: huge task → spawn sub-swarm
  if (depth < MAX_RECURSION && desc.length > 1200 && desc.toLowerCase().includes("split")) {
    return spawnSubswarm(task, dept, ctx, depth + 1, mem, onLog);
  }

  const name = `${dept}-W-${task.id}`;
  const a    = new HydraAgent(name, `${dept} implementation engineer`, "coding", 0.2, 8000);
  const full = (
    `Task ID: ${task.id}\nTitle: ${task.title}\nTarget file: ${task.file_hint}\n` +
    `Description: ${desc}\n\nImplement fully. Emit one or more ===FILE: path=== blocks.`
  );
  onLog(`  ⚙️  [${name}] ${task.title}`);
  return a.run(full, ctx + "\n" + mem.contextSnippet(), mem, onLog);
}

async function spawnSubswarm(
  task:  AtomicTask,
  dept:  string,
  ctx:   string,
  depth: number,
  mem:   SharedMemory,
  onLog: (msg: string) => void,
): Promise<AgentResult> {
  onLog(`  🔀 [${dept}-Splitter-d${depth}] Fractal split at depth ${depth}`);
  const sysPrompt = (
    "Split this task into 3-6 smaller atomic subtasks. JSON: " +
    '{"subtasks":[{"id":"...","title":"...","file_hint":"...","description":"..."}]}'
  );
  const raw  = await callLlm(
    JSON.stringify(task), sysPrompt, "fast", 2000, 0.2, true,
    `${dept}-Splitter-d${depth}`, mem, onLog,
  );
  const subs: AtomicTask[] = extractJson(raw)?.subtasks ?? [];

  if (!subs.length) {
    const a = new HydraAgent(`${dept}-W-fb`, `${dept} engineer`, "coding", 0.2, 8000);
    return a.run(JSON.stringify(task), ctx, mem, onLog);
  }

  const subResults = await Promise.allSettled(
    subs.map(st => workerExecute(st, dept, ctx, depth, mem, onLog))
  );

  const mergedFiles: ProjectFiles = {};
  const mergedOut:   string[]     = [];
  for (const r of subResults) {
    if (r.status === "fulfilled") {
      Object.assign(mergedFiles, r.value.files);
      mergedOut.push(r.value.output);
    }
  }
  return {
    name:   `${dept}-subswarm-d${depth}`,
    output: mergedOut.join("\n"),
    files:  mergedFiles,
    meta:   {},
  };
}

// ============================================================
// LAYER 5 — CRITIC RING (3 adversarial reviewers in parallel)
// ============================================================

const CRITICS: Array<[string, string]> = [
  ["BugHunter",       "ruthless senior engineer hunting for bugs, edge cases, runtime errors"],
  ["SecurityAuditor", "security auditor hunting injection, XSS, auth flaws, secret leaks"],
  ["UXCritic",        "senior product designer hunting UX/accessibility issues"],
];

export async function criticReview(
  filePath: string,
  code:     string,
  mem:      SharedMemory,
  onLog:    (msg: string) => void,
): Promise<{ verdict: "pass" | "fix"; issues: string[] }> {
  const ctx     = `FILE: ${filePath}\n\n${code.slice(0, 6000)}`;
  const sysBase = 'Review the code. Output strict JSON: {"verdict":"pass|fix","severity":"low|med|high","issues":["..."]}';

  const outs = await Promise.allSettled(
    CRITICS.map(([n, r]) =>
      callLlm(ctx, `You are ${n}, a ${r}. ${sysBase}`, "critic", 1500, 0.2, true, n, mem, onLog)
    )
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
}

async function fixPass(
  filePath: string,
  code:     string,
  issues:   string[],
  mem:      SharedMemory,
  onLog:    (msg: string) => void,
): Promise<string> {
  const system = `Rewrite the file fixing every issue. Emit a single ===FILE: ${filePath}=== block. No commentary.`;
  const prompt = `ORIGINAL:\n${code}\n\nISSUES:\n- ${issues.join("\n- ")}`;
  const out    = await callLlm(prompt, system, "coding", 8000, 0.2, false, `Fixer:${filePath}`, mem, onLog);
  return extractCodeFiles(out)[filePath] ?? code;
}

// ============================================================
// LAYER 6 — SYNTHESIZER
// ============================================================

async function synthesizeAndResolve(
  mem:   SharedMemory,
  onLog: (msg: string) => void,
): Promise<void> {
  onLog(`\n🧬 [SYNTHESIZER] Reconciling ${Object.keys(mem.files).length} files...`);
  // Last-write-wins is already enforced by SharedMemory.writeFile.
  // Future: add conflict-detection for overlapping imports / missing refs.
}

// ============================================================
// LAYER 7 — VALIDATOR & PACKAGER
// ============================================================

function packageProject(mem: SharedMemory, onLog: (msg: string) => void): ProjectFiles {
  const output: ProjectFiles = { ...mem.files };

  if (!output["README.md"]) {
    output["README.md"] = (
      `# ${mem.blueprint.project_name ?? "Project"}\n\n` +
      `Type: ${mem.blueprint.project_type}\n\n` +
      "Generated by HYDRA-PRIME SWARM v4.\n\n" +
      "## Features\n- " + (mem.blueprint.key_features ?? []).join("\n- ") + "\n"
    );
  }

  if (!output[".env.example"]) {
    output[".env.example"] = "OPENROUTER_API_KEY=\nDATABASE_URL=\nJWT_SECRET=\n";
  }

  output["BUILD_REPORT.json"] = JSON.stringify({
    blueprint: mem.blueprint,
    files:     Object.keys(mem.files),
    metrics:   mem.metrics,
    decisions: mem.decisions,
  }, null, 2);

  onLog(`\n📦 [VALIDATOR] Packaged ${Object.keys(output).length} files`);
  return output;
}

// ============================================================
// ORCHESTRATOR — MAIN ENTRY POINT
// ============================================================

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
  onLog("=".repeat(60));
  onLog("HYDRA-PRIME SWARM v4 — engaging");
  onLog("=".repeat(60));

  // L1 — SOVEREIGN
  const blueprint = await sovereign(userPrompt, mem, onLog);

  // L2 — ARCHITECT COUNCIL
  const tdd = await architectCouncil(blueprint, mem, onLog);
  const ctx = JSON.stringify({ blueprint, tdd }, null, 2).slice(0, 12000);

  // L3 — Select departments for this project type
  const depts = selectDepartments(blueprint);
  onLog(`\n🏢 Departments: ${depts.join(", ")}`);

  const decomps  = await Promise.all(depts.map(d => departmentHeadDecompose(d, ctx, mem, onLog)));
  const deptWork = depts.map((d, i) => ({ dept: d, tasks: decomps[i] }));
  const total    = deptWork.reduce((s, dw) => s + dw.tasks.length, 0);
  onLog(`📋 ${total} atomic tasks across ${depts.length} departments`);

  // L4 — FRACTAL WORKER SWARM (capped by semaphore)
  const coros: Promise<AgentResult>[] = [];
  for (const { dept, tasks } of deptWork) {
    for (const t of tasks) coros.push(workerExecute(t, dept, ctx, 0, mem, onLog));
  }
  onLog(`\n⚙️  Spawning ${coros.length} workers (cap ${MAX_PARALLEL})...`);

  const results = await Promise.allSettled(coros);
  for (const r of results) {
    if (r.status === "rejected") { mem.errors.push(String(r.reason)); continue; }
    for (const [p, c] of Object.entries(r.value.files)) mem.writeFile(p, c);
  }

  // L5 — CRITIC RING
  onLog(`\n🔍 Critic ring reviewing ${Object.keys(mem.files).length} files...`);
  const fileEntries = Object.entries(mem.files);
  const reviews     = await Promise.allSettled(
    fileEntries.map(([p, c]) => criticReview(p, c, mem, onLog))
  );

  const fixPaths: string[]           = [];
  const fixCoros: Promise<string>[]  = [];
  for (let i = 0; i < fileEntries.length; i++) {
    const rev = reviews[i];
    if (rev.status !== "fulfilled") continue;
    const [path, code] = fileEntries[i];
    if (rev.value.verdict === "fix" && rev.value.issues.length) {
      fixPaths.push(path);
      fixCoros.push(fixPass(path, code, rev.value.issues, mem, onLog));
    }
  }

  if (fixCoros.length) {
    onLog(`🛠  Fixing ${fixCoros.length} files...`);
    const fixed = await Promise.allSettled(fixCoros);
    for (let i = 0; i < fixPaths.length; i++) {
      const r = fixed[i];
      if (r.status === "fulfilled" && r.value) mem.writeFile(fixPaths[i], r.value);
    }
  }

  // L6 — SYNTHESIZER
  await synthesizeAndResolve(mem, onLog);

  // L7 — VALIDATOR & PACKAGER
  const files = packageProject(mem, onLog);

  onLog("\n" + "=".repeat(60));
  onLog(
    `✅ BUILD COMPLETE — ${mem.metrics.calls} LLM calls, ` +
    `${mem.metrics.tokensIn + mem.metrics.tokensOut} tokens`
  );
  onLog("=".repeat(60));

  return {
    files,
    blueprint: mem.blueprint,
    metrics:   mem.metrics,
    decisions: mem.decisions,
    errors:    mem.errors,
  };
}
