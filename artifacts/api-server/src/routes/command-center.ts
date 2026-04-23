import { Router, type IRouter } from "express";
import { spawn } from "child_process";
import { db } from "@workspace/db";
import {
  customAgentsTable,
  agentModelAssignmentsTable,
  consoleHistoryTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth.js";
import { AGENT_REGISTRY } from "../lib/agents.js";
import { nanoid } from "../lib/nanoid.js";
import { getOpenRouterClient } from "../lib/openrouterSdk.js";

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
    const sdk = getOpenRouterClient();
    const result: any = await sdk.chat.send({
      httpReferer: "https://nexuselitestudio.com",
      appTitle:    "NexusElite AI Studio",
      chatRequest: {
        model:    agent.model,
        messages: [
          { role: "system", content: agent.systemPrompt },
          { role: "user",   content: String(task) },
        ],
        stream: false,
      },
    });
    const choice = result?.choices?.[0];
    res.json({
      output: choice?.message?.content ?? "",
      usage:  result?.usage ?? null,
      agent:  { id: agent.id, name: agent.name, model: agent.model },
    });
  } catch (err: any) {
    res.status(500).json({ error: "run_failed", message: err.message });
  }
});

export default router;
