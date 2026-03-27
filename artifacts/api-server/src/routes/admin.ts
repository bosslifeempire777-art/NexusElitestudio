import { Router, type IRouter } from "express";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

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
        : `You are the self-repair AI for Nexus Studio, a production TypeScript/React/Express platform.
You can read and rewrite the platform's source files to fix bugs, add features, or change behavior.

Rules:
- Respond with a valid JSON object ONLY. No prose outside JSON.
- Schema:
{
  "message": "What you did and why (2-4 sentences)",
  "files": [
    { "path": "relative/path/from/workspace/root", "content": "COMPLETE file content — never truncate", "action": "modified|created" }
  ],
  "changes": ["bullet: what changed in file X", "bullet: what changed in file Y"],
  "requiresRestart": true/false
}
- Only include files that actually change.
- Provide COMPLETE file content — never use "// ... rest unchanged" placeholders.
- Be surgical: change as little as possible to solve the problem.
- If you cannot safely make a change, return empty "files" array and explain in "message".`;

    const aiRes = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://nexus-studio.replit.app",
      },
      body: JSON.stringify({
        model: "openrouter/auto",
        max_tokens: 8000,
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
    } else if (Array.isArray(parsed.files) && parsed.files.length > 0) {
      for (const f of parsed.files as Array<{ path: string; content: string; action: string }>) {
        if (!f.path || !f.content) continue;
        const isAllowed = ALLOWED_PATHS.some((p) => f.path.startsWith(p));
        if (!isAllowed) {
          errors.push(`Blocked: ${f.path} (outside allowed directories)`);
          continue;
        }
        const fullPath = join(WORKSPACE_ROOT, f.path);
        try {
          mkdirSync(dirname(fullPath), { recursive: true });
          writeFileSync(fullPath, f.content, "utf-8");
          applied.push(`${f.action === "created" ? "Created" : "Modified"}: ${f.path}`);
        } catch (err: any) {
          errors.push(`Write failed for ${f.path}: ${err.message}`);
        }
      }
    }

    return res.json({
      message: parsed.message ?? "Done",
      changes: parsed.changes ?? [],
      applied,
      errors,
      requiresRestart: parsed.requiresRestart ?? false,
    });
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

export default router;
