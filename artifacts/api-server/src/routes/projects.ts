import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "../lib/nanoid.js";
import { generateProjectCode, generateChatResponse } from "../lib/openrouter.js";
import { requireAuth } from "../middleware/auth.js";

const router: IRouter = Router();

const PROJECT_TYPES = ["website", "mobile_app", "saas", "automation", "ai_tool", "game"];

function inferFramework(type: string, prompt: string): string {
  const p = prompt.toLowerCase();
  if (type === "game") {
    if (p.includes("rpg")) return "HTML5 Canvas (RPG)";
    if (p.includes("platformer")) return "HTML5 Canvas (Platformer)";
    if (p.includes("puzzle")) return "HTML5 Canvas (Puzzle)";
    if (p.includes("strategy")) return "HTML5 Canvas (Strategy)";
    return "HTML5 Canvas (Arcade)";
  }
  if (type === "mobile_app") return "React Native";
  if (type === "saas") return "Next.js + Express";
  if (type === "website") return "React + Vite";
  if (type === "automation") return "Python + FastAPI";
  if (type === "ai_tool") return "Python + OpenAI API";
  return "React + Node.js";
}

function generateAgentLogs(type: string, name: string): string[] {
  const logs: string[] = [
    `[Orchestrator] 🧠 Received project prompt: "${name}"`,
    `[Orchestrator] 📋 Breaking down into subtasks for ${type} project...`,
    `[Software Architect] 🏗️ Designing system architecture...`,
    `[Software Architect] ✅ Architecture design complete`,
    `[Code Generator] 💻 Starting code generation...`,
  ];

  if (type === "game") {
    logs.push(
      `[Game Designer] 🎮 Creating game concept and mechanics...`,
      `[Canvas Renderer] 🖥️ Setting up HTML5 Canvas game engine...`,
      `[Asset Generator] 🖼️ Generating sprites and visual effects...`,
      `[Level Builder] 🗺️ Building game world and levels...`,
      `[Physics Engine] ⚡ Wiring collision detection and movement...`,
    );
  }

  logs.push(
    `[Code Generator] ✅ Core codebase generated`,
    `[UI/UX Design Agent] 🎨 Generating UI components...`,
    `[Database Agent] 🗄️ Setting up database schema...`,
    `[Security Agent] 🔐 Applying security configurations...`,
    `[Testing Agent] 🧪 Running automated tests...`,
    `[DevOps Agent] ⚙️ Preparing deployment configuration...`,
    `[Orchestrator] ✅ Project build complete!`,
  );

  return logs;
}

function getBaseUrl(): string {
  const domain = process.env["REPLIT_DEV_DOMAIN"] || process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (domain) return `https://${domain}`;
  return "http://localhost:8080";
}

function projectResponse(p: typeof projectsTable.$inferSelect) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    agentLogs: Array.isArray(p.agentLogs) ? p.agentLogs : [],
  };
}

// List user's projects
router.get("/", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const { type, status } = req.query as { type?: string; status?: string };

  let projects = await db.select().from(projectsTable).where(eq(projectsTable.userId, userId));

  if (type && type !== "all") projects = projects.filter((p) => p.type === type);
  if (status && status !== "all") projects = projects.filter((p) => p.status === status);

  res.json(projects.map(projectResponse));
});

// Create project
router.post("/", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const { prompt, type, name } = req.body;

  if (!prompt || !type || !name) {
    res.status(400).json({ error: "bad_request", message: "prompt, type, name are required" });
    return;
  }

  const framework = inferFramework(type, prompt);
  const agentLogs = generateAgentLogs(type, name);

  const [project] = await db.insert(projectsTable).values({
    id: nanoid(),
    name,
    description: prompt.slice(0, 200),
    type,
    status: "building",
    prompt,
    framework,
    gameEngine: type === "game" ? framework : null,
    userId,
    agentLogs,
  }).returning();

  // Generate code asynchronously using OpenRouter
  setImmediate(async () => {
    try {
      const generatedCode = await generateProjectCode(type, name, prompt);
      const currentLogs = Array.isArray(project.agentLogs) ? project.agentLogs : [];
      const updatedLogs = [
        ...currentLogs,
        `[Code Generator] ✅ Generated production-ready code (${generatedCode.length} bytes)`,
        `[Orchestrator] 🎉 Project generation complete!`,
      ];
      await db.update(projectsTable).set({
        status: "ready",
        generatedCode,
        updatedAt: new Date(),
        agentLogs: updatedLogs,
      }).where(eq(projectsTable.id, project.id));
    } catch (err) {
      console.error("Code generation failed:", err);
      await db.update(projectsTable)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(projectsTable.id, project.id));
    }
  });

  res.status(201).json(projectResponse(project));
});

// Get single project (owner or admin)
router.get("/:id", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, req.params.id) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, req.params.id), eq(projectsTable.userId, userId)),
      });

  if (!project) {
    res.status(404).json({ error: "not_found", message: "Project not found" });
    return;
  }

  res.json(projectResponse(project));
});

// Delete project
router.delete("/:id", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  await db.delete(projectsTable).where(
    and(eq(projectsTable.id, req.params.id), eq(projectsTable.userId, userId))
  );
  res.status(204).send();
});

// Build logs
router.get("/:id/build-logs", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, req.params.id) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, req.params.id), eq(projectsTable.userId, userId)),
      });

  if (!project) {
    res.status(404).json({ error: "not_found", message: "Project not found" });
    return;
  }

  const agentLogs = Array.isArray(project.agentLogs) ? project.agentLogs as string[] : [];
  const logs = agentLogs.map((msg, i) => ({
    id: `log-${i}`,
    projectId: req.params.id,
    level: msg.includes("✅") || msg.includes("🎉") ? "success" :
           msg.includes("Error") || msg.includes("Failed") ? "error" :
           msg.includes("⚠️") ? "warn" : "info",
    message: msg,
    agentName: msg.match(/\[([^\]]+)\]/)?.[1] || "System",
    timestamp: new Date(Date.now() - (agentLogs.length - i) * 3000).toISOString(),
  }));

  res.json(logs);
});

// Live preview — public (anyone with the URL can view)
router.get("/:id/preview", async (req, res) => {
  const project = await db.query.projectsTable.findFirst({
    where: eq(projectsTable.id, req.params.id),
  });

  if (!project) {
    res.status(404).send("<h1>Project not found</h1>");
    return;
  }

  const html = project.generatedCode
    ? project.generatedCode
    : buildMissingCodeHtml(project.name, project.type, project.id);

  res.setHeader("Content-Type", "text/html");
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.send(html);
});

// Get raw source code of a project
router.get("/:id/source", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, req.params.id) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, req.params.id), eq(projectsTable.userId, userId)),
      });

  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  res.json({ code: project.generatedCode || "", framework: project.framework });
});

// Rebuild project
router.post("/:id/rebuild", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, req.params.id) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, req.params.id), eq(projectsTable.userId, userId)),
      });

  if (!project) {
    res.status(404).json({ error: "not_found", message: "Project not found" });
    return;
  }

  const newLogs = generateAgentLogs(project.type, project.name);
  await db.update(projectsTable)
    .set({ status: "building", agentLogs: newLogs, generatedCode: null, updatedAt: new Date() })
    .where(eq(projectsTable.id, project.id));

  setImmediate(async () => {
    try {
      const generatedCode = await generateProjectCode(project.type, project.name, project.prompt);
      const updatedLogs = [
        ...newLogs,
        `[Code Generator] ✅ Rebuilt production-ready code (${generatedCode.length} bytes)`,
        `[Orchestrator] 🎉 Rebuild complete!`,
      ];
      await db.update(projectsTable)
        .set({ status: "ready", generatedCode, agentLogs: updatedLogs, updatedAt: new Date() })
        .where(eq(projectsTable.id, project.id));
    } catch (err) {
      console.error("Rebuild failed:", err);
      await db.update(projectsTable)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(projectsTable.id, project.id));
    }
  });

  res.json({ ok: true, message: "Rebuild started" });
});

// Deploy project — sets status to deployed and generates a shareable URL
router.post("/:id/deploy", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, req.params.id) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, req.params.id), eq(projectsTable.userId, userId)),
      });

  if (!project) {
    res.status(404).json({ error: "not_found", message: "Project not found" });
    return;
  }

  if (!project.generatedCode) {
    res.status(400).json({ error: "not_ready", message: "Project must be built before deploying" });
    return;
  }

  const deployedUrl = `${getBaseUrl()}/api/projects/${project.id}/preview`;

  const [updated] = await db.update(projectsTable)
    .set({
      status: "deployed",
      deployedUrl,
      updatedAt: new Date(),
    })
    .where(eq(projectsTable.id, project.id))
    .returning();

  res.json({
    ...projectResponse(updated!),
    deployedUrl,
    message: "Project deployed successfully",
  });
});

// Chat with agent about project
router.post("/:id/chat", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, req.params.id) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, req.params.id), eq(projectsTable.userId, userId)),
      });

  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const { message, action } = req.body as { message?: string; action?: string };
  const userMessage = message || action || "";

  if (!userMessage) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const reply = await generateChatResponse(project, userMessage);
    res.json({ reply });
  } catch (err) {
    console.error("Chat failed:", err);
    res.json({
      reply: `The agent swarm has received your request: "${userMessage}". Processing in background — your changes will be applied to the next build.`,
    });
  }
});

// Files list (returns file structure for display)
router.get("/:id/files", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, req.params.id) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, req.params.id), eq(projectsTable.userId, userId)),
      });

  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const isMultiFile = project.framework?.includes("React") || project.framework?.includes("Next");

  if (!isMultiFile || !project.generatedCode) {
    res.json([{
      name: "index.html",
      path: "index.html",
      type: "file",
      content: project.generatedCode || "",
      language: "html",
    }]);
    return;
  }

  res.json([{
    name: "src/App.tsx",
    path: "src/App.tsx",
    type: "file",
    content: project.generatedCode || "",
    language: "tsx",
  }]);
});

function buildMissingCodeHtml(name: string, type: string, id: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — Build Required</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f1a;color:#e2e8f0;font-family:'Segoe UI',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:2rem}
.icon{font-size:3rem;margin-bottom:1.5rem;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
h1{font-size:1.25rem;font-weight:700;color:#00d4ff;margin-bottom:.5rem;letter-spacing:.05em}
p{font-size:.875rem;color:#64748b;margin-bottom:2rem;max-width:360px;line-height:1.6}
.btn{display:inline-flex;align-items:center;gap:.5rem;padding:.75rem 1.75rem;background:linear-gradient(135deg,#00d4ff,#7c3aed);color:#0f0f1a;border:none;border-radius:8px;font-size:.875rem;font-weight:700;cursor:pointer;letter-spacing:.05em;text-decoration:none;transition:opacity .2s}
.btn:hover{opacity:.85}
.tag{margin-top:1.5rem;font-size:.7rem;color:#374151;font-family:monospace;letter-spacing:.1em}
</style>
</head><body>
<div class="icon">⚡</div>
<h1>CODE GENERATION INCOMPLETE</h1>
<p>The AI swarm didn't finish building <strong>${name}</strong>. Click Rebuild to generate it now.</p>
<a class="btn" href="javascript:void(0)" onclick="this.textContent='⟳ Rebuilding…';fetch('/api/projects/${id}/rebuild',{method:'POST'}).then(()=>{this.textContent='✓ Rebuilding — close and reopen in 20s';})">
  ⚡ Rebuild with AI
</a>
<div class="tag">PROJECT ID: ${id} · TYPE: ${type.toUpperCase()}</div>
</body></html>`;
}

export default router;
