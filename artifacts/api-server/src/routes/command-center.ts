import { Router, type IRouter } from "express";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@workspace/db";
import {
  customAgentsTable,
  agentModelAssignmentsTable,
  consoleHistoryTable,
} from "@workspace/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { MODEL_TIERS, invalidateTierCache } from "../lib/hydraSwarm.js";
import { ROLE_REGISTRY, selfImprovement, ALL_TOOL_NAMES } from "../lib/genesisSwarm.js";
import { ALL_CONCIERGE_TOOL_NAMES } from "../lib/conciergeAgent.js";
import { requireAdmin } from "../middleware/auth.js";
import { AGENT_REGISTRY } from "../lib/agents.js";
import { nanoid } from "../lib/nanoid.js";
import { getOpenRouterClient, chatViaSdk, listModels, getCredits } from "../lib/openrouterSdk.js";
import { runAgentWithTools, ALL_AGENT_TOOLS } from "../lib/agentTools.js";

const router: IRouter = Router();
router.use(requireAdmin);

const WORKSPACE = "/home/runner/workspace";
const EXEC_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1_000_000;

// Hard blocklist for catastrophic operations. Admin still has wide latitude
// (this is intentional — the user wants a real shell), but the most obviously
// destructive system-wide commands are blocked.
const BLOCK_PATTERNS = [
  /\brm\s+-rf\s+(\/|\$HOME|~)(\s|$)/,
  /\bmkfs\b/,
  /\bdd\s+if=.*of=\/dev\//,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,            // fork bomb
  /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/,
  /\bchmod\s+-R\s+777\s+\//,
];

function isBlocked(cmd: string): string | null {
  for (const re of BLOCK_PATTERNS) if (re.test(cmd)) return re.source;
  return null;
}

/* ── Console: shell command execution ─────────────────────────── */
router.post("/exec", async (req, res) => {
  const userId = req.auth!.userId;
  const command = String(req.body?.command ?? "").trim();
  if (!command) { res.status(400).json({ error: "command is required" }); return; }
  if (command.length > 4000) { res.status(400).json({ error: "command too long (max 4000 chars)" }); return; }

  const blocked = isBlocked(command);
  if (blocked) {
    res.status(400).json({ error: "blocked_command", message: `Command matches blocked pattern: ${blocked}` });
    return;
  }

  const start = Date.now();
  const stdoutBufs: Buffer[] = [];
  const stderrBufs: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let truncated = false;

  const child = spawn("bash", ["-lc", command], {
    cwd: WORKSPACE,
    env: { ...process.env, PAGER: "cat", GIT_PAGER: "cat", CI: "1" },
  });

  const killTimer = setTimeout(() => {
    try { child.kill("SIGKILL"); } catch {}
  }, EXEC_TIMEOUT_MS);

  const totalBytes = () => stdoutBytes + stderrBytes;

  child.stdout.on("data", (chunk: Buffer) => {
    const remaining = MAX_OUTPUT_BYTES - totalBytes();
    if (remaining <= 0) {
      truncated = true;
      try { child.kill("SIGKILL"); } catch {}
      return;
    }
    if (chunk.length > remaining) {
      stdoutBufs.push(chunk.subarray(0, remaining));
      stdoutBytes += remaining;
      truncated = true;
      try { child.kill("SIGKILL"); } catch {}
    } else {
      stdoutBufs.push(chunk);
      stdoutBytes += chunk.length;
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const remaining = MAX_OUTPUT_BYTES - totalBytes();
    if (remaining <= 0) {
      truncated = true;
      try { child.kill("SIGKILL"); } catch {}
      return;
    }
    if (chunk.length > remaining) {
      stderrBufs.push(chunk.subarray(0, remaining));
      stderrBytes += remaining;
      truncated = true;
      try { child.kill("SIGKILL"); } catch {}
    } else {
      stderrBufs.push(chunk);
      stderrBytes += chunk.length;
    }
  });

  child.on("close", async (code, signal) => {
    clearTimeout(killTimer);
    const durationMs = Date.now() - start;
    const exitCode = signal ? `signal:${signal}` : String(code ?? "");
    const stdout = Buffer.concat(stdoutBufs).toString("utf8");
    const stderr = Buffer.concat(stderrBufs).toString("utf8");

    try {
      await db.insert(consoleHistoryTable).values({
        id: nanoid(),
        userId,
        command,
        exitCode,
        stdout: stdout.slice(0, 10_000),
        stderr: stderr.slice(0, 10_000),
        durationMs: String(durationMs),
      });
    } catch (e) {
      console.error("[command-center] history insert failed:", (e as any)?.message);
    }

    res.json({
      command,
      exitCode,
      durationMs,
      truncated,
      stdout: truncated ? stdout + "\n\n…[OUTPUT TRUNCATED — exceeded 1 MB combined]" : stdout,
      stderr,
    });
  });

  child.on("error", (err) => {
    clearTimeout(killTimer);
    res.status(500).json({ error: "spawn_failed", message: err.message });
  });
});

router.get("/history", async (_req, res) => {
  const rows = await db.select()
    .from(consoleHistoryTable)
    .orderBy(desc(consoleHistoryTable.createdAt))
    .limit(50);
  res.json({ history: rows });
});

/* ── OpenRouter: model catalogue ──────────────────────────────── */
let modelCache: { ts: number; data: any[] } | null = null;
const MODEL_CACHE_MS = 10 * 60 * 1000;

router.get("/openrouter/models", async (_req, res) => {
  try {
    if (modelCache && Date.now() - modelCache.ts < MODEL_CACHE_MS) {
      res.json({ data: modelCache.data, cached: true });
      return;
    }
    const r = await fetch("https://openrouter.ai/api/v1/models", {
      headers: process.env.OPENROUTER_API_KEY
        ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
        : {},
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      res.status(r.status).json({ error: "openrouter_error", message: await r.text() });
      return;
    }
    const j = await r.json() as { data: any[] };
    const slim = (j.data || []).map((m: any) => ({
      id: m.id,
      name: m.name,
      contextLength: m.context_length,
      pricing: m.pricing,
      description: m.description,
      modality: m.architecture?.modality,
    }));
    modelCache = { ts: Date.now(), data: slim };
    res.json({ data: slim, cached: false });
  } catch (err: any) {
    res.status(500).json({ error: "fetch_failed", message: err.message });
  }
});

/* ── Built-in agent → model assignments ──────────────────────── */
router.get("/agent-assignments", async (_req, res) => {
  const rows = await db.select().from(agentModelAssignmentsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.agentId] = r.model;

  const agents = AGENT_REGISTRY.map((a: any) => ({
    id: a.id,
    name: a.name,
    icon: a.icon,
    category: a.category,
    description: a.description,
    model: map[a.id] ?? null,
  }));
  res.json({ agents });
});

router.post("/agent-assignments", async (req, res) => {
  const userId = req.auth!.userId;
  const { agentId, model } = req.body ?? {};
  if (!agentId || !model) { res.status(400).json({ error: "agentId and model required" }); return; }
  const exists = AGENT_REGISTRY.find((a: any) => a.id === agentId);
  if (!exists) { res.status(404).json({ error: "agent not found in registry" }); return; }

  await db.insert(agentModelAssignmentsTable)
    .values({ agentId, model, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: agentModelAssignmentsTable.agentId,
      set: { model, updatedBy: userId, updatedAt: new Date() },
    });
  res.json({ ok: true });
});

router.delete("/agent-assignments/:agentId", async (req, res) => {
  await db.delete(agentModelAssignmentsTable).where(eq(agentModelAssignmentsTable.agentId, req.params.agentId));
  res.json({ ok: true });
});

/* ── Custom agents ───────────────────────────────────────────── */
router.get("/custom-agents", async (_req, res) => {
  const rows = await db.select().from(customAgentsTable).orderBy(desc(customAgentsTable.createdAt));
  res.json({ agents: rows });
});

router.post("/custom-agents", async (req, res) => {
  const userId = req.auth!.userId;
  const { name, description, model, systemPrompt, icon, category, capabilities } = req.body ?? {};
  if (!name || !model || !systemPrompt) {
    res.status(400).json({ error: "name, model, and systemPrompt are required" });
    return;
  }
  const id = nanoid();
  const [row] = await db.insert(customAgentsTable).values({
    id,
    name: String(name).slice(0, 100),
    description: String(description ?? "").slice(0, 1000),
    icon: String(icon ?? "🤖").slice(0, 8),
    category: String(category ?? "custom").slice(0, 50),
    model: String(model),
    systemPrompt: String(systemPrompt),
    capabilities: Array.isArray(capabilities) ? capabilities.map(String).slice(0, 20) : [],
    createdBy: userId,
  }).returning();
  res.json({ agent: row });
});

router.put("/custom-agents/:id", async (req, res) => {
  const { id } = req.params;
  const b = req.body ?? {};
  const updates: any = {};
  if (b.name !== undefined)         updates.name         = String(b.name).slice(0, 100);
  if (b.description !== undefined)  updates.description  = String(b.description).slice(0, 1000);
  if (b.model !== undefined)        updates.model        = String(b.model).slice(0, 200);
  if (b.systemPrompt !== undefined) updates.systemPrompt = String(b.systemPrompt).slice(0, 20_000);
  if (b.icon !== undefined)         updates.icon         = String(b.icon).slice(0, 8);
  if (b.category !== undefined)     updates.category     = String(b.category).slice(0, 50);
  if (b.isActive !== undefined)     updates.isActive     = Boolean(b.isActive);
  if (Array.isArray(b.capabilities)) updates.capabilities = b.capabilities.map(String).slice(0, 20);
  updates.updatedAt = new Date();
  const [row] = await db.update(customAgentsTable).set(updates).where(eq(customAgentsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  res.json({ agent: row });
});

router.delete("/custom-agents/:id", async (req, res) => {
  await db.delete(customAgentsTable).where(eq(customAgentsTable.id, req.params.id));
  res.json({ ok: true });
});

router.post("/custom-agents/:id/run", async (req, res) => {
  const { id } = req.params;
  const { task } = req.body ?? {};
  if (!task) { res.status(400).json({ error: "task required" }); return; }
  const [agent] = await db.select().from(customAgentsTable).where(eq(customAgentsTable.id, id));
  if (!agent) { res.status(404).json({ error: "agent not found" }); return; }

  if (!process.env.OPENROUTER_API_KEY) {
    res.status(500).json({ error: "OPENROUTER_API_KEY not set" }); return;
  }

  try {
    // Use the full agentic tool loop — agents can now run bash (tests!),
    // read/write files, search code, and fetch URLs.
    const result = await runAgentWithTools({
      model:        agent.model,
      task:         String(task),
      tools:        ALL_AGENT_TOOLS,
      maxSteps:     30,
      systemPrompt: agent.systemPrompt,
    });

    res.json({
      output:        result.text,
      toolCallCount: result.toolCallCount,
      usage: {
        prompt_tokens:     result.inputTokens,
        completion_tokens: result.outputTokens,
        total_tokens:      result.inputTokens + result.outputTokens,
      },
      agent: { id: agent.id, name: agent.name, model: agent.model },
    });
  } catch (err: any) {
    const isTimeout = err?.name === "AbortError" || /timeout/i.test(err?.message ?? "");
    if (isTimeout) {
      res.status(504).json({
        error:   "model_timeout",
        message: `${agent.model} timed out. Try a faster model (gpt-4o-mini, gemini-2.0-flash) or shorten the task.`,
      });
      return;
    }

    const status: number | undefined =
      err?.statusCode ?? err?.status ?? err?.response?.status;
    const msg = String(err?.message ?? "");
    const isCreditsError =
      status === 402 ||
      /insufficient credits|requires more credits|add more credits/i.test(msg);
    if (isCreditsError) {
      res.status(402).json({
        error:   "openrouter_insufficient_credits",
        message: "OpenRouter account is out of credits. Add credits at https://openrouter.ai/settings/credits then retry.",
      });
      return;
    }

    // Some models don't support tool calling — fall back to plain chat
    const noTools = /tool|function.*call|not support/i.test(msg);
    if (noTools) {
      try {
        const fallback: any = await chatViaSdk({
          model:    agent.model,
          messages: [
            { role: "system", content: agent.systemPrompt },
            { role: "user",   content: String(task) },
          ],
        }, { timeoutMs: 120_000 });
        res.json({
          output:        fallback?.choices?.[0]?.message?.content ?? "",
          toolCallCount: 0,
          usage:         fallback?.usage ?? null,
          agent:         { id: agent.id, name: agent.name, model: agent.model },
          note:          "Tool calling not supported by this model — ran without tools.",
        });
        return;
      } catch (fbErr: any) {
        res.status(500).json({ error: "run_failed", message: fbErr?.message ?? String(fbErr) });
        return;
      }
    }

    res.status(500).json({ error: "run_failed", message: err?.message ?? String(err) });
  }
});

/* ── Telemetry: read devtools capture file ───────────────────── */
const TELEMETRY_PATH = path.resolve(
  process.env.OPENROUTER_DEVTOOLS_STORAGE_PATH ??
    ".devtools/openrouter-generations.json",
);
const TELEMETRY_MAX_BYTES = 50 * 1024 * 1024; // 50 MB hard cap to avoid DoS
const MSG_TRUNCATE = 8_000;                   // per-message char cap in response

function truncStr(s: any): string | null {
  if (s == null) return s ?? null;
  const str = String(s);
  return str.length > MSG_TRUNCATE
    ? str.slice(0, MSG_TRUNCATE) + `\n…[truncated ${str.length - MSG_TRUNCATE} chars]`
    : str;
}

router.get("/telemetry", async (_req, res) => {
  try {
    const stat = await fs.stat(TELEMETRY_PATH).catch(() => null);
    if (!stat) {
      res.json({ runs: [], stats: empty(), path: TELEMETRY_PATH });
      return;
    }
    if (stat.size > TELEMETRY_MAX_BYTES) {
      res.status(413).json({
        error: "telemetry_too_large",
        message: `Capture file is ${stat.size} bytes (limit ${TELEMETRY_MAX_BYTES}). Clear telemetry to continue.`,
        path: TELEMETRY_PATH,
      });
      return;
    }
    const raw = await fs.readFile(TELEMETRY_PATH, "utf8");
    const all = JSON.parse(raw || "[]");
    if (!Array.isArray(all)) {
      res.json({ runs: [], stats: empty(), path: TELEMETRY_PATH });
      return;
    }
    // Newest first, capped to 200 most recent
    const runs = all.slice(-200).reverse().map((r: any) => {
      const step = r.steps?.[0] ?? {};
      const u = step.response?.usage ?? {};
      const startedAt = step.started_at ?? r.started_at;
      const completedAt = step.completed_at ?? r.completed_at;
      const durationMs = startedAt && completedAt
        ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
        : null;
      return {
        id: r.id,
        startedAt,
        completedAt,
        durationMs,
        operation: r.operation,
        model: r.model ?? step.request?.model ?? null,
        provider: step.response?.provider ?? null,
        status: r.status,
        finishReason: step.response?.finish_reason ?? null,
        promptTokens: u.prompt_tokens ?? null,
        completionTokens: u.completion_tokens ?? null,
        totalTokens: u.total_tokens ?? null,
        messages: (step.request?.messages ?? []).map((m: any) => ({
          role: m?.role ?? "unknown",
          content: truncStr(m?.content),
        })),
        responseContent: truncStr(step.response?.content),
        error: step.error ?? null,
      };
    });

    const stats = {
      totalRuns: all.length,
      success: all.filter((r: any) => r.status === "success").length,
      errors: all.filter((r: any) => r.status === "error").length,
      totalTokens: all.reduce(
        (s: number, r: any) =>
          s + (r.steps?.[0]?.response?.usage?.total_tokens ?? 0),
        0,
      ),
    };
    res.json({ runs, stats, path: TELEMETRY_PATH });
  } catch (err: any) {
    res.status(500).json({ error: "telemetry_failed", message: err.message });
  }
});

router.delete("/telemetry", async (_req, res) => {
  try {
    await fs.mkdir(path.dirname(TELEMETRY_PATH), { recursive: true });
    await fs.writeFile(TELEMETRY_PATH, "[]", "utf8");
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "telemetry_clear_failed", message: err.message });
  }
});

function empty() {
  return { totalRuns: 0, success: 0, errors: 0, totalTokens: 0 };
}

/* ── Swarm tier configuration ─────────────────────────────── */
const VALID_TIERS = ["reasoning", "coding", "fast", "longctx", "critic", "creative"];

router.get("/swarm-tiers", async (_req, res) => {
  try {
    const result = await db.execute(sql`SELECT tier, models, updated_at, updated_by FROM swarm_tier_config`);
    const saved: Record<string, string[]> = {};
    for (const row of (result as any).rows ?? []) {
      saved[String(row.tier)] = Array.isArray(row.models) ? row.models as string[] : [];
    }
    res.json({ tiers: saved, defaults: MODEL_TIERS });
  } catch (err: any) {
    res.status(500).json({ error: "fetch_failed", message: err.message });
  }
});

router.put("/swarm-tiers", async (req, res) => {
  const userId = req.auth!.userId;
  const { tiers } = req.body ?? {};
  if (!tiers || typeof tiers !== "object") {
    res.status(400).json({ error: "tiers object required" }); return;
  }
  try {
    for (const [tier, models] of Object.entries(tiers)) {
      if (!VALID_TIERS.includes(tier)) continue;
      if (!Array.isArray(models)) continue;
      const clean = (models as string[])
        .filter(m => typeof m === "string" && m.trim().length > 0)
        .map(m => m.trim())
        .slice(0, 20);
      await db.execute(sql`
        INSERT INTO swarm_tier_config (tier, models, updated_at, updated_by)
        VALUES (${tier}, ${JSON.stringify(clean)}::jsonb, NOW(), ${userId})
        ON CONFLICT (tier) DO UPDATE SET
          models     = EXCLUDED.models,
          updated_at = NOW(),
          updated_by = ${userId}
      `);
    }
    invalidateTierCache();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "save_failed", message: err.message });
  }
});

router.delete("/swarm-tiers/:tier", async (req, res) => {
  const { tier } = req.params;
  if (!VALID_TIERS.includes(tier)) {
    res.status(400).json({ error: "invalid tier" }); return;
  }
  try {
    await db.execute(sql`DELETE FROM swarm_tier_config WHERE tier = ${tier}`);
    invalidateTierCache();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "delete_failed", message: err.message });
  }
});

/* ── Role Registry — per-role model config ────────────────── */

// Default tool sets per role category (mirrors genesisSwarm.ts defaults)
const DEFAULT_WORKER_TOOLS   = [...ALL_TOOL_NAMES] as string[];
const DEFAULT_GUARDIAN_TOOLS = ["read_file", "list_directory", "search_code", "fetch_url"];
const DEFAULT_REPAIR_TOOLS   = ["bash_command", "read_file", "search_code"];

function defaultToolsForRole(tier: string, role: string): string[] {
  if (tier === "guardian") {
    return role === "REPAIR" ? DEFAULT_REPAIR_TOOLS : DEFAULT_GUARDIAN_TOOLS;
  }
  return DEFAULT_WORKER_TOOLS;
}

router.get("/role-registry", async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT tier, role, primary_slug, fallbacks, tools FROM swarm_role_config
    `);
    const rows = (result as any).rows ?? [];

    // Build flat registry: { cost: { PLANNER: { primary, fallbacks, specialty, tools } } }
    type FlatEntry = { primary: string; fallbacks: string[]; specialty: string; tools: string[] };
    const flat: Record<string, Record<string, FlatEntry>> = {};
    for (const [tier, roles] of Object.entries(ROLE_REGISTRY)) {
      flat[tier] = {};
      for (const [role, conf] of Object.entries(roles as Record<string, any>)) {
        flat[tier][role] = {
          primary:   conf.primary.slug,
          fallbacks: conf.fallbacks.map((f: any) => f.slug),
          specialty: conf.specialty ?? "",
          tools:     defaultToolsForRole(tier, role),
        };
      }
    }

    // Apply DB overrides
    const concierge: { primary: string; fallbacks: string[]; tools: string[] } = {
      primary: "google/gemini-2.5-flash",
      fallbacks: ["openai/gpt-4o-mini", "deepseek/deepseek-chat"],
      tools: [...ALL_CONCIERGE_TOOL_NAMES],
    };
    for (const row of rows) {
      const tier    = String(row.tier);
      const role    = String(row.role);
      const primary = String(row.primary_slug);
      const fb: string[] = Array.isArray(row.fallbacks) ? row.fallbacks.map(String) : [];
      const savedTools: string[] | null = Array.isArray(row.tools) && row.tools.length > 0
        ? row.tools.map(String)
        : null;
      if (tier === "concierge" && role === "main") {
        concierge.primary   = primary;
        concierge.fallbacks = fb;
        if (savedTools) concierge.tools = savedTools;
      } else if (flat[tier]?.[role]) {
        flat[tier][role].primary   = primary;
        flat[tier][role].fallbacks = fb;
        if (savedTools) flat[tier][role].tools = savedTools;
      }
    }

    res.json({
      registry: flat,
      concierge,
      allToolNames:          [...ALL_TOOL_NAMES],
      allConciergeToolNames: [...ALL_CONCIERGE_TOOL_NAMES],
    });
  } catch (err: any) {
    res.status(500).json({ error: "fetch_failed", message: err.message });
  }
});

router.put("/role-registry", async (req, res) => {
  const userId = (req as any).auth?.userId ?? "admin";
  const { registry, concierge } = req.body ?? {};
  try {
    if (registry && typeof registry === "object") {
      for (const [tier, roles] of Object.entries(registry)) {
        if (!["cost", "premium", "guardian"].includes(tier)) continue;
        for (const [role, conf] of Object.entries(roles as Record<string, any>)) {
          const primary = String(conf.primary ?? "").trim();
          if (!primary) continue;
          const fallbacks = (Array.isArray(conf.fallbacks) ? conf.fallbacks : [])
            .filter((s: any) => typeof s === "string" && s.trim())
            .map((s: string) => s.trim());
          const tools = (Array.isArray(conf.tools) ? conf.tools : [])
            .filter((s: any) => typeof s === "string" && (ALL_TOOL_NAMES as readonly string[]).includes(s));
          await db.execute(sql`
            INSERT INTO swarm_role_config (tier, role, primary_slug, fallbacks, tools, updated_at, updated_by)
            VALUES (${tier}, ${role}, ${primary}, ${JSON.stringify(fallbacks)}::jsonb, ${JSON.stringify(tools)}::jsonb, NOW(), ${userId})
            ON CONFLICT (tier, role) DO UPDATE SET
              primary_slug = EXCLUDED.primary_slug,
              fallbacks    = EXCLUDED.fallbacks,
              tools        = EXCLUDED.tools,
              updated_at   = NOW(),
              updated_by   = ${userId}
          `);
        }
      }
    }
    if (concierge?.primary) {
      const primary = String(concierge.primary).trim();
      const fallbacks = (Array.isArray(concierge.fallbacks) ? concierge.fallbacks : [])
        .filter((s: any) => typeof s === "string" && s.trim()).map((s: string) => s.trim());
      // Validate concierge tools against known names (allow-list)
      const conciergeTools = (Array.isArray(concierge.tools) ? concierge.tools : [])
        .filter((s: any) => typeof s === "string" && (ALL_CONCIERGE_TOOL_NAMES as readonly string[]).includes(s));
      await db.execute(sql`
        INSERT INTO swarm_role_config (tier, role, primary_slug, fallbacks, tools, updated_at, updated_by)
        VALUES ('concierge', 'main', ${primary}, ${JSON.stringify(fallbacks)}::jsonb, ${JSON.stringify(conciergeTools)}::jsonb, NOW(), ${userId})
        ON CONFLICT (tier, role) DO UPDATE SET
          primary_slug = EXCLUDED.primary_slug,
          fallbacks    = EXCLUDED.fallbacks,
          tools        = EXCLUDED.tools,
          updated_at   = NOW(),
          updated_by   = ${userId}
      `);
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "save_failed", message: err.message });
  }
});

router.delete("/role-registry/:tier/:role", async (req, res) => {
  const { tier, role } = req.params;
  try {
    await db.execute(sql`DELETE FROM swarm_role_config WHERE tier = ${tier} AND role = ${role}`);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "delete_failed", message: err.message });
  }
});

/* ── Self-Improvement Engine ──────────────────────────────── */

router.get("/self-improvement/insights", (_req, res) => {
  try {
    res.json(selfImprovement.getInsights());
  } catch (err: any) {
    res.status(500).json({ error: "insights_failed", message: err.message });
  }
});

router.get("/self-improvement/suggest/:tier", (req, res) => {
  try {
    const suggested = selfImprovement.suggestReordering(req.params.tier);
    res.json({ tier: req.params.tier, suggested });
  } catch (err: any) {
    res.status(500).json({ error: "suggest_failed", message: err.message });
  }
});

/* ── OpenRouter — models list & credits ───────────────────── */

router.get("/or-models", async (_req, res) => {
  try {
    const models = await listModels();
    res.json({ models });
  } catch (err: any) {
    res.status(500).json({ error: "models_failed", message: err.message });
  }
});

router.get("/or-credits", async (_req, res) => {
  try {
    const credits = await getCredits();
    res.json(credits);
  } catch (err: any) {
    res.status(500).json({ error: "credits_failed", message: err.message });
  }
});

export default router;
