import { Router, type IRouter } from "express";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "fs";
import { join, dirname, resolve, sep } from "path";
import { db } from "@workspace/db";
import { projectsTable, referralsTable, creditTransactionsTable, usersTable, buildsTable } from "@workspace/db/schema";
import { eq, count, sum, desc, sql, inArray } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth.js";
import { getRecentTraffic, getTrafficSummary } from "../lib/traffic-log.js";

const router: IRouter = Router();

router.use(requireAdmin);

const WORKSPACE_ROOT = "/home/runner/workspace";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

function getApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY;
}

function extractJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  return raw;
}

const ALLOWED_PATHS = [
  "artifacts/api-server/src",
  "artifacts/ai-studio/src",
  "lib/db/src",
];

function collectFiles(
  dirPath: string,
  relPath: string,
  results: Array<{ path: string; content: string }>,
  maxFiles: number,
) {
  if (results.length >= maxFiles) return;
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= maxFiles) break;
    if (["node_modules", "dist", ".git", "__pycache__"].includes(entry) || entry.startsWith(".")) continue;
    const fullPath = join(dirPath, entry);
    const relEntry = `${relPath}/${entry}`;
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      if (!/\.(ts|tsx|json|css|html)$/.test(entry)) continue;
      try {
        const content = readFileSync(fullPath, "utf-8");
        if (content.length < 40000) {
          results.push({ path: relEntry, content });
        }
      } catch {}
    } else if (stat.isDirectory()) {
      collectFiles(fullPath, relEntry, results, maxFiles);
    }
  }
}

function getPlatformFiles(requestedPaths?: string[]): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  const paths = requestedPaths?.length ? requestedPaths : ALLOWED_PATHS;
  for (const p of paths) {
    if (results.length >= 25) break;
    const full = join(WORKSPACE_ROOT, p);
    if (!existsSync(full)) continue;
    const stat = statSync(full);
    if (stat.isFile()) {
      try {
        const content = readFileSync(full, "utf-8");
        if (content.length < 40000) results.push({ path: p, content });
      } catch {}
    } else {
      collectFiles(full, p, results, 25);
    }
  }
  return results;
}

/** POST /admin/repair */
router.post("/repair", async (req, res) => {
  const { message, mode = "platform", projectId, focusPaths } = req.body as {
    message: string;
    mode?: "platform" | "project";
    projectId?: string;
    focusPaths?: string[];
  };

  const API_KEY = getApiKey();
  if (!message?.trim()) return res.status(400).json({ error: "message is required" });
  if (!API_KEY) return res.status(503).json({ error: "AI not configured — OPENROUTER_API_KEY missing. Ensure the secret is set and restart the API Server workflow." });

  try {
    let contextBlock = "";
    let projectCode: string | null = null;
    let projectName = "";

    if (mode === "project" && projectId) {
      const project = await db.query.projectsTable.findFirst({
        where: eq(projectsTable.id, projectId),
      });
      if (!project) return res.status(404).json({ error: "Project not found" });
      projectName = project.name;
      projectCode = project.generatedCode;
      contextBlock = `Project: "${project.name}" (type: ${project.type})
Original prompt: ${project.prompt}

Current generated code:
\`\`\`html
${projectCode ?? "(no code generated yet)"}
\`\`\``;
    } else {
      const files = getPlatformFiles(focusPaths);
      contextBlock = files
        .map((f) => `=== FILE: ${f.path} ===\n${f.content}`)
        .join("\n\n---\n\n");
    }

    const systemPrompt =
      mode === "project"
        ? `You are an expert code repair AI embedded in Nexus Studio.
Your job: edit or fix a generated single-file HTML application based on admin instructions.

Rules:
- Respond with a valid JSON object ONLY. No prose outside JSON.
- Schema:
{
  "message": "What you did (1-3 sentences, be specific)",
  "updatedCode": "COMPLETE updated HTML — never truncate or use placeholders",
  "changes": ["change 1", "change 2", ...]
}`
        : `You are the self-repair AI for NexusElite Studio, a production TypeScript/React/Express monorepo.
You can read and rewrite source files, run safe SQL migrations, and request a workflow restart.

ARCHITECTURE you MUST respect:
- Backend: Express + Drizzle ORM + PostgreSQL, in artifacts/api-server/src.
  Routes go in artifacts/api-server/src/routes/<name>.ts and must be registered in artifacts/api-server/src/routes/index.ts.
  Auth: import { requireAuth, requireAdmin } from "../middleware/auth.js" — every protected route uses these.
  DB: import { db } from "@workspace/db" and tables from "@workspace/db/schema".
- DB schema lives in lib/db/src/schema/<name>.ts. After adding a new table file, you MUST also add an export line to lib/db/src/schema/index.ts.
- Frontend: React + Vite in artifacts/ai-studio/src. Pages in src/pages/, components in src/components/.
  UI primitives are in @/components/ui/cyber-ui (Card, CardContent, CardHeader, CardTitle, Button, Input, Badge, Textarea).
  Auth helper: import { getToken } from "@/lib/auth"; pass it as Authorization: Bearer <token>.

RESPONSE FORMAT — return ONE JSON object, no prose outside JSON:
{
  "message": "Plain-language summary of what you did and why (2-5 sentences)",
  "files": [
    { "path": "relative/path/from/workspace/root", "content": "COMPLETE file content (NEVER truncate or use '// ...rest unchanged')", "action": "modified" | "created" }
  ],
  "sql": [
    "CREATE TABLE IF NOT EXISTS ...",
    "ALTER TABLE foo ADD COLUMN bar text"
  ],
  "changes": ["bullet describing change 1", "bullet describing change 2"],
  "requiresRestart": true | false
}

CRITICAL RULES:
- Provide COMPLETE file content for every file in "files". Truncation breaks the platform.
- For new features, list ALL the files needed (route file + index registration + UI page + any nav links).
- "sql" runs each statement in order BEFORE files are written. ONLY safe DDL/DML allowed: CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN, CREATE INDEX, CREATE UNIQUE INDEX. NEVER drop, truncate, or delete rows.
- Set "requiresRestart": true if you changed any TS file in artifacts/api-server (the API process needs to reload).
- Be surgical AND complete. Don't skip wiring (e.g. if you create a route, register it; if you create a page, link to it from a nav menu).
- If the request is unsafe or impossible, return empty "files"/"sql" and explain in "message".`;

    // Use a strong, code-capable model for platform repairs (defaulting to Claude
    // Sonnet which handles multi-file refactors well). Project-mode (single HTML
    // file) can run on a cheaper model.
    const REPAIR_MODEL =
      mode === "platform"
        ? (process.env.REPAIR_MODEL || "anthropic/claude-sonnet-4")
        : (process.env.REPAIR_MODEL_PROJECT || "anthropic/claude-sonnet-4");

    const aiRes = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://nexuselitestudio.com",
        "X-Title": "NexusElite Self-Repair",
      },
      body: JSON.stringify({
        model: REPAIR_MODEL,
        max_tokens: 16000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `${contextBlock}\n\n---\n\nAdmin instruction: ${message}`,
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return res.status(502).json({ error: `AI error (${aiRes.status}): ${errText.slice(0, 300)}` });
    }

    const aiData = await aiRes.json() as any;
    const raw = aiData.choices?.[0]?.message?.content as string | undefined;
    if (!raw) return res.status(502).json({ error: "Empty AI response" });

    let parsed: any;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch {
      return res.json({ message: raw, files: [], changes: [], applied: [], errors: [], requiresRestart: false });
    }

    const applied: string[] = [];
    const errors: string[] = [];

    if (mode === "project" && parsed.updatedCode && projectId) {
      await db
        .update(projectsTable)
        .set({ generatedCode: parsed.updatedCode, status: "ready", updatedAt: new Date() })
        .where(eq(projectsTable.id, projectId));
      applied.push(`Updated generated code for project "${projectName}"`);
    } else {
      // 1) Run SQL migrations FIRST (so new tables exist before code refers to them).
      //    Strict allowlist:
      //      - SINGLE statement only (no internal semicolons, no SQL comments)
      //      - End-anchored regex against one of:
      //          CREATE TABLE IF NOT EXISTS …
      //          ALTER TABLE <name> ADD COLUMN …
      //          CREATE [UNIQUE] INDEX [IF NOT EXISTS] …
      //    Multi-statement payloads like
      //      "CREATE TABLE IF NOT EXISTS x(...); DROP TABLE users; --"
      //    are rejected because of the embedded semicolon and `--` comment.
      if (Array.isArray(parsed.sql)) {
        for (const stmt of parsed.sql as string[]) {
          if (typeof stmt !== "string") continue;
          const s = stmt.trim().replace(/;+\s*$/, "");
          if (!s) continue;

          if (s.includes(";") || s.includes("--") || s.includes("/*") || s.includes("*/")) {
            errors.push(`SQL blocked (multi-statement or comment not allowed): ${s.slice(0, 80)}…`);
            continue;
          }
          const safe =
            /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+[\s\S]+\)\s*$/i.test(s) ||
            /^ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\s+[\s\S]+$/i.test(s) ||
            /^CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?[\s\S]+$/i.test(s);
          if (!safe) {
            errors.push(`SQL blocked (only CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN / CREATE INDEX permitted): ${s.slice(0, 80)}…`);
            continue;
          }
          try {
            await db.execute(sql.raw(s));
            applied.push(`SQL executed: ${s.slice(0, 80)}${s.length > 80 ? "…" : ""}`);
          } catch (err: any) {
            errors.push(`SQL failed (${s.slice(0, 60)}…): ${err.message}`);
          }
        }
      }

      // 2) Write files. Path validation MUST resolve the absolute path and
      //    confirm it stays inside one of the allowed roots, so traversal
      //    payloads like "artifacts/api-server/src/../../etc/passwd" cannot
      //    escape the prefix check.
      const allowedAbsRoots = ALLOWED_PATHS.map((p) => resolve(WORKSPACE_ROOT, p) + sep);
      if (Array.isArray(parsed.files) && parsed.files.length > 0) {
        for (const f of parsed.files as Array<{ path: string; content: string; action: string }>) {
          if (!f.path || !f.content) continue;
          // Reject absolute paths and any whitespace/null shenanigans up front.
          if (f.path.startsWith("/") || f.path.includes("\0")) {
            errors.push(`Blocked: ${f.path} (absolute or invalid path)`);
            continue;
          }
          const fullPath = resolve(WORKSPACE_ROOT, f.path);
          const fullPathWithSep = fullPath + sep;
          const insideAllowed = allowedAbsRoots.some(
            (root) => fullPath === root.slice(0, -1) || fullPathWithSep.startsWith(root) || (fullPath + sep).startsWith(root),
          );
          if (!insideAllowed) {
            errors.push(`Blocked: ${f.path} (resolved path escapes allowed directories)`);
            continue;
          }
          try {
            mkdirSync(dirname(fullPath), { recursive: true });
            writeFileSync(fullPath, f.content, "utf-8");
            applied.push(`${f.action === "created" ? "Created" : "Modified"}: ${f.path}`);
          } catch (err: any) {
            errors.push(`Write failed for ${f.path}: ${err.message}`);
          }
        }
      }
    }

    // 3) Auto-restart workflow if API-server source changed and no errors.
    //    We send the response BEFORE restarting so the admin sees the result;
    //    the actual exit happens ~800ms later, by which time Replit will
    //    relaunch the workflow command and Vite-dev's frontend will reconnect.
    const wantsRestart =
      !!parsed.requiresRestart &&
      errors.length === 0 &&
      applied.some((a) => a.includes("artifacts/api-server"));
    let restartScheduled = false;

    res.json({
      message: parsed.message ?? "Done",
      changes: parsed.changes ?? [],
      applied,
      errors,
      requiresRestart: parsed.requiresRestart ?? false,
      restartScheduled: wantsRestart,
    });

    if (wantsRestart) {
      restartScheduled = true;
      console.log("[admin/repair] auto-restart scheduled in 800ms (api-server source changed)");
      setTimeout(() => {
        // exit(0) — pnpm/Replit workflow will relaunch us automatically.
        process.exit(0);
      }, 800);
    }
    return restartScheduled;
  } catch (err: any) {
    console.error("[admin/repair]", err);
    return res.status(500).json({ error: err.message ?? "Unknown error" });
  }
});

/** GET /admin/files — list editable source files */
router.get("/files", (_req, res) => {
  const files: string[] = [];
  function walk(dir: string, rel: string) {
    if (files.length >= 200) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= 200) break;
      if (["node_modules", "dist", ".git"].includes(e) || e.startsWith(".")) continue;
      const full = join(dir, e);
      const r = `${rel}/${e}`;
      try {
        const s = statSync(full);
        if (s.isFile() && /\.(ts|tsx)$/.test(e)) files.push(r);
        else if (s.isDirectory()) walk(full, r);
      } catch {}
    }
  }
  for (const p of ALLOWED_PATHS) walk(join(WORKSPACE_ROOT, p), p);
  res.json({ files });
});

/**
 * GET /admin/activity?limit=50 — combined platform activity feed.
 * Pulls from real DB tables (users, projects, builds, credit_transactions)
 * and returns them sorted newest-first.
 */
router.get("/activity", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  try {
    const [recentUsers, recentProjects, recentBuilds, recentCredits] = await Promise.all([
      db.select({
        id: usersTable.id, username: usersTable.username, email: usersTable.email,
        plan: usersTable.plan, ts: usersTable.createdAt,
      }).from(usersTable).orderBy(desc(usersTable.createdAt)).limit(limit),
      db.select({
        id: projectsTable.id, name: projectsTable.name, type: projectsTable.type,
        userId: projectsTable.userId, status: projectsTable.status, ts: projectsTable.createdAt,
      }).from(projectsTable).orderBy(desc(projectsTable.createdAt)).limit(limit),
      db.select({
        id: buildsTable.id, projectId: buildsTable.projectId,
        status: buildsTable.status, ts: buildsTable.startedAt,
      }).from(buildsTable).orderBy(desc(buildsTable.startedAt)).limit(limit),
      db.select({
        id: creditTransactionsTable.id, userId: creditTransactionsTable.userId,
        type: creditTransactionsTable.type, amount: creditTransactionsTable.amount,
        ts: creditTransactionsTable.createdAt,
      }).from(creditTransactionsTable).orderBy(desc(creditTransactionsTable.createdAt)).limit(limit),
    ]);

    // Resolve usernames for project/build/credit events in one query
    const userIds = new Set<string>();
    for (const p of recentProjects) userIds.add(p.userId);
    for (const c of recentCredits) userIds.add(c.userId);
    const projectIds = new Set<string>();
    for (const b of recentBuilds) projectIds.add(b.projectId);

    const [userRows, projectRows] = await Promise.all([
      userIds.size === 0 ? [] : db.select({ id: usersTable.id, username: usersTable.username })
        .from(usersTable).where(inArray(usersTable.id, Array.from(userIds))),
      projectIds.size === 0 ? [] : db.select({ id: projectsTable.id, name: projectsTable.name, userId: projectsTable.userId })
        .from(projectsTable).where(inArray(projectsTable.id, Array.from(projectIds))),
    ]);
    const usernameById: Record<string, string> = {};
    for (const u of userRows) usernameById[u.id] = u.username;
    const projectById: Record<string, { name: string; userId: string }> = {};
    for (const p of projectRows) projectById[p.id] = { name: p.name, userId: p.userId };

    type Event = {
      id: string;
      kind: "signup" | "project" | "build" | "credit";
      ts: string;
      title: string;
      detail: string;
      username: string | null;
      meta: Record<string, any>;
    };
    const events: Event[] = [];

    for (const u of recentUsers) {
      events.push({
        id: `u_${u.id}`, kind: "signup", ts: new Date(u.ts).toISOString(),
        title: `New user signup`,
        detail: `${u.username}${u.email ? ` (${u.email})` : ""} on ${u.plan.toUpperCase()} plan`,
        username: u.username,
        meta: { userId: u.id, plan: u.plan },
      });
    }
    for (const p of recentProjects) {
      events.push({
        id: `p_${p.id}`, kind: "project", ts: new Date(p.ts).toISOString(),
        title: `Project created`,
        detail: `"${p.name}" (${p.type}) — status ${p.status}`,
        username: usernameById[p.userId] ?? null,
        meta: { projectId: p.id, type: p.type, status: p.status },
      });
    }
    for (const b of recentBuilds) {
      const proj = projectById[b.projectId];
      events.push({
        id: `b_${b.id}`, kind: "build", ts: new Date(b.ts).toISOString(),
        title: `Build ${b.status}`,
        detail: proj ? `for "${proj.name}"` : `for project ${b.projectId.slice(0, 8)}`,
        username: proj ? usernameById[proj.userId] ?? null : null,
        meta: { projectId: b.projectId, status: b.status },
      });
    }
    for (const c of recentCredits) {
      events.push({
        id: `c_${c.id}`, kind: "credit", ts: new Date(c.ts).toISOString(),
        title: `Credits ${c.amount >= 0 ? "+" : ""}${c.amount}`,
        detail: `${c.type.replace(/_/g, " ")}`,
        username: usernameById[c.userId] ?? null,
        meta: { userId: c.userId, type: c.type, amount: c.amount },
      });
    }

    events.sort((a, b) => b.ts.localeCompare(a.ts));
    res.json({ events: events.slice(0, limit), counts: {
      users: recentUsers.length,
      projects: recentProjects.length,
      builds: recentBuilds.length,
      credits: recentCredits.length,
    } });
  } catch (err: any) {
    console.error("[admin/activity]", err);
    res.status(500).json({ error: err.message ?? "Failed to load activity" });
  }
});

/** GET /admin/traffic — recent HTTP requests + summary from in-memory ring buffer. */
router.get("/traffic", (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
  res.json({
    summary: getTrafficSummary(),
    recent: getRecentTraffic(limit),
  });
});

router.get("/referrals", async (_req, res) => {
  try {
    const [{ total: totalReferrals }] = await db.select({ total: count() }).from(referralsTable);
    const [{ total: totalConverted }]  = await db.select({ total: count() }).from(referralsTable)
      .where(eq(referralsTable.status, "converted"));
    const [{ total: totalCreditsAwarded }] = await db.select({ total: sum(creditTransactionsTable.amount) })
      .from(creditTransactionsTable)
      .where(eq(creditTransactionsTable.type, "referral_signup"));

    const topReferrers = await db.select({
      username: usersTable.username,
      creditBalance: usersTable.creditBalance,
      referralCount: count(referralsTable.id),
    })
      .from(usersTable)
      .leftJoin(referralsTable, eq(referralsTable.referrerId, usersTable.id))
      .groupBy(usersTable.id, usersTable.username, usersTable.creditBalance)
      .orderBy(desc(count(referralsTable.id)))
      .limit(10);

    res.json({
      totalReferrals: Number(totalReferrals),
      totalConverted: Number(totalConverted),
      totalCreditsAwarded: Number(totalCreditsAwarded ?? 0),
      topReferrers: topReferrers.filter((r: any) => Number(r.referralCount) > 0),
    });
  } catch (err) {
    console.error("Admin referrals error:", err);
    res.status(500).json({ error: "Failed to load referral stats" });
  }
});

export default router;
