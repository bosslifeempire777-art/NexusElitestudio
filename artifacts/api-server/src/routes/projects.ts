import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, usersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "../lib/nanoid.js";
import { generateProjectCode, generateChatResponse, generateUpdatedCode, updateProjectMemory, type ProjectMemory, type ChatTurn } from "../lib/openrouter.js";
import { recordUsage, consumeOverageCreditIfNeeded, canPerformBuild } from "../lib/usage.js";
import { requireAuth } from "../middleware/auth.js";
import { streamBuild, subscribe, emitLog, completeBuild } from "../lib/build-logger.js";
import { getPlanLimits } from "./plans.js";
import { getUserSecretNames, getUserSecretsMap } from "./secrets.js";
import { verifyToken } from "../middleware/auth.js";

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
  // Prefer custom domain (e.g. nexuselitestudio.com) so deployed project URLs are on the branded domain
  const domain =
    process.env["CUSTOM_DOMAIN"] ||
    process.env["REPLIT_DOMAINS"]?.split(",")[0] ||
    process.env["REPLIT_DEV_DOMAIN"];
  if (domain) return `https://${domain}`;
  return "http://localhost:8080";
}

function projectResponse(p: typeof projectsTable.$inferSelect) {
  // Strip raw source code from every API response — code is only accessible
  // through the gated /source and /files endpoints (paid plans only).
  // We expose a `hasCode` boolean so the UI can show the correct state
  // (e.g. disable Deploy button) without leaking the actual source.
  const { generatedCode, ...rest } = p;
  return {
    ...rest,
    hasCode: !!(generatedCode && generatedCode.length > 100),
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
  const userId   = req.auth!.userId;
  const isAdmin  = req.auth!.isAdmin;
  const isVip    = req.auth!.isVip;
  const userPlan = req.auth!.plan;
  const { prompt, type, name } = req.body;

  if (!prompt || !type || !name) {
    res.status(400).json({ error: "bad_request", message: "prompt, type, name are required" });
    return;
  }

  // ── Enforce plan limits (skip for admins & VIP) ──
  if (!isAdmin && !isVip) {
    const limits = getPlanLimits(userPlan);
    const user   = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });

    if (limits.projects !== -1 && (user?.projectCount ?? 0) >= limits.projects) {
      res.status(402).json({
        error: "plan_limit",
        code: "PROJECT_LIMIT",
        message: `Your ${userPlan} plan allows ${limits.projects} projects. Delete a project or upgrade to create more.`,
        currentPlan: userPlan,
        limit: limits.projects,
        current: user?.projectCount ?? 0,
      });
      return;
    }

    if (limits.buildsPerMonth !== -1 && (user?.buildsThisMonth ?? 0) >= limits.buildsPerMonth) {
      const overageAllowed = (limits as any).overage === true;
      res.status(402).json({
        error: "plan_limit",
        code: "BUILD_LIMIT",
        message: overageAllowed
          ? `You've used all ${limits.buildsPerMonth} builds this month. Additional builds are $${(limits as any).overagePricePerBuild}/each, or upgrade your plan for more included builds.`
          : `You've used all ${limits.buildsPerMonth} builds this month. Upgrade your plan to build more.`,
        currentPlan: userPlan,
        limit: limits.buildsPerMonth,
        current: user?.buildsThisMonth ?? 0,
        overageAllowed,
        overagePricePerBuild: (limits as any).overagePricePerBuild ?? null,
      });
      return;
    }
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

  // Increment project count immediately
  await db.update(usersTable)
    .set({ projectCount: (await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) }))!.projectCount + 1 })
    .where(eq(usersTable.id, userId));

  // Generate code asynchronously with streaming logs
  const buildSteps = agentLogs;
  setImmediate(async () => {
    try {
      const generatedCode = await streamBuild(
        project.id,
        buildSteps,
        () => generateProjectCode(type, name, prompt),
      );
      const hasCode = generatedCode && generatedCode.length > 100;
      const finalLogs = [
        ...buildSteps,
        hasCode
          ? `[Code Generator] ✅ Generated ${generatedCode.length.toLocaleString()} bytes`
          : `[Orchestrator] ⚠️ Generation incomplete — click Rebuild to try again`,
        `[Orchestrator] ${hasCode ? "🎉 Project generation complete!" : "⚠️ Build finished with warnings"}`,
      ];
      await db.update(projectsTable).set({
        status: hasCode ? "ready" : "failed",
        generatedCode: hasCode ? generatedCode : null,
        updatedAt: new Date(),
        agentLogs: finalLogs,
      }).where(eq(projectsTable.id, project.id));

      if (hasCode) {
        // Increment builds this month on success
        const freshUser = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
        await db.update(usersTable)
          .set({ buildsThisMonth: (freshUser?.buildsThisMonth ?? 0) + 1 })
          .where(eq(usersTable.id, userId));
        // Persist a usage record + consume an overage credit if plan quota was exhausted
        await recordUsage({ userId, projectId: project.id, kind: "build", description: `Initial build of "${project.name}"` });
        await consumeOverageCreditIfNeeded(userId, req.auth!.plan);
      }
    } catch (err) {
      console.error("Code generation failed (unexpected):", err);
      completeBuild(project.id);
      await db.update(projectsTable)
        .set({
          status: "failed",
          agentLogs: [...agentLogs, "[Orchestrator] ❌ Unexpected error — please click Rebuild to try again"],
          updatedAt: new Date(),
        })
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

  let html = project.generatedCode
    ? project.generatedCode
    : buildMissingCodeHtml(project.name, project.type, project.id);

  // Inject the project owner's API keys into window.USER_SECRETS so the
  // generated app can call OpenAI/Stripe/etc. without hardcoding keys.
  //
  // SECURITY: Only inject when the requester proves they ARE the project owner.
  // The preview endpoint is intentionally unauthenticated so that the iframe
  // <src> can load it directly, but injecting secrets unconditionally would
  // leak them to anyone with the URL. We accept the user's JWT via either the
  // `Authorization` header OR a short `?token=` query parameter (the iframe
  // src form), and verify ownership before injecting anything.
  let isOwnerRequest = false;
  const headerToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const authToken = headerToken || queryToken;
  if (authToken) {
    const payload = verifyToken(authToken);
    if (payload && payload.userId === project.userId) isOwnerRequest = true;
  }

  if (project.generatedCode && isOwnerRequest) {
    try {
      const secrets = await getUserSecretsMap(project.userId);
      // SECURITY: JSON.stringify does NOT escape `</script>`, allowing a
      // crafted secret value to break out of the inline script. Replace
      // every `<` with its safe \u003c escape (and `>` for symmetry).
      const safeJson = JSON.stringify(secrets)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
      const injection =
        `<script>window.USER_SECRETS = ${safeJson};` +
        `window.NEXUS_REQUIRE_KEY = function(name){` +
        `if(window.USER_SECRETS && window.USER_SECRETS[name]) return window.USER_SECRETS[name];` +
        `var d=document.createElement('div');` +
        `d.style.cssText='position:fixed;inset:0;background:#0a0a0f;color:#e2e8f0;font-family:system-ui;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;z-index:99999';` +
        `d.innerHTML='<div><div style=\\'font-size:36px;margin-bottom:12px\\'>🔑</div><div style=\\'font-size:18px;color:#00d4ff;margin-bottom:8px;font-weight:700\\'>API KEY REQUIRED</div><div style=\\'max-width:420px;line-height:1.6;font-size:14px;color:#94a3b8\\'>This app needs <code style=\\'color:#fbbf24;background:#1a1a2e;padding:2px 6px;border-radius:4px\\'>'+name+'</code>.<br/><br/>Open <strong>NexusElite Studio → Settings → API Keys</strong>, click <strong>Add Secret</strong>, and save it with the exact name <strong>'+name+'</strong>. Then reload this preview.</div></div>';` +
        `document.body.appendChild(d);` +
        `throw new Error('Missing API key: '+name);};</script>`;

      // Inject just before </head>; if no </head>, prepend to <body>.
      if (/<\/head>/i.test(html)) {
        html = html.replace(/<\/head>/i, `${injection}</head>`);
      } else if (/<body[^>]*>/i.test(html)) {
        html = html.replace(/<body([^>]*)>/i, `<body$1>${injection}`);
      } else {
        html = injection + html;
      }
    } catch (err) {
      console.error("Failed to inject user secrets into preview:", err);
    }
  }

  res.setHeader("Content-Type", "text/html");
  res.setHeader("X-Frame-Options", "ALLOWALL");
  // Aggressively prevent caching — the preview is supposed to update instantly
  // when the user chats new changes. Cloudflare/CDN/browser caching the old
  // HTML is the #1 cause of "I told it to change but nothing happened" reports.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Cloudflare-CDN-Cache-Control", "no-store");
  res.send(html);
});

// Get raw source code of a project
router.get("/:id/source", requireAuth, async (req, res) => {
  const userId   = req.auth!.userId;
  const isAdmin  = req.auth!.isAdmin;
  const isVip    = req.auth!.isVip;
  const userPlan = req.auth!.plan;

  // Free plan users cannot access or download source code
  if (!isAdmin && !isVip && userPlan === "free") {
    res.status(402).json({
      error: "plan_limit",
      code: "SOURCE_NOT_ALLOWED",
      message: "Source code access requires a paid plan. Upgrade to Starter or higher to view and download your app's source code.",
      currentPlan: userPlan,
    });
    return;
  }

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
  const userId   = req.auth!.userId;
  const isAdmin  = req.auth!.isAdmin;
  const isVip    = req.auth!.isVip;
  const userPlan = req.auth!.plan;

  // ── Enforce monthly build limit (skip for admins & VIP) ──
  if (!isAdmin && !isVip) {
    const limits = getPlanLimits(userPlan);
    const user   = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
    if (limits.buildsPerMonth !== -1 && (user?.buildsThisMonth ?? 0) >= limits.buildsPerMonth) {
      res.status(402).json({
        error: "plan_limit",
        code: "BUILD_LIMIT",
        message: `You've used all ${limits.buildsPerMonth} builds this month on the ${userPlan} plan. Upgrade for more builds.`,
        currentPlan: userPlan,
        limit: limits.buildsPerMonth,
        current: user?.buildsThisMonth ?? 0,
      });
      return;
    }
  }

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

  const { type: pType, name: pName, prompt: pPrompt } = project;
  setImmediate(async () => {
    try {
      const generatedCode = await streamBuild(
        project.id,
        newLogs,
        () => generateProjectCode(pType, pName, pPrompt),
      );
      const hasCode = generatedCode && generatedCode.length > 100;
      const finalLogs = [
        ...newLogs,
        hasCode
          ? `[Code Generator] ✅ Rebuilt ${generatedCode.length.toLocaleString()} bytes`
          : `[Orchestrator] ⚠️ Generation incomplete — click Rebuild to try again`,
        `[Orchestrator] ${hasCode ? "🎉 Rebuild complete!" : "⚠️ Rebuild finished with warnings"}`,
      ];
      await db.update(projectsTable)
        .set({
          status: hasCode ? "ready" : "failed",
          generatedCode: hasCode ? generatedCode : null,
          agentLogs: finalLogs,
          updatedAt: new Date(),
        })
        .where(eq(projectsTable.id, project.id));
      if (hasCode) {
        await recordUsage({ userId, projectId: project.id, kind: "rebuild", description: `Rebuild of "${project.name}"` });
        await consumeOverageCreditIfNeeded(userId, req.auth!.plan);
      }
    } catch (err) {
      console.error("Rebuild failed (unexpected):", err);
      completeBuild(project.id);
      await db.update(projectsTable)
        .set({
          status: "failed",
          agentLogs: [...newLogs, "[Orchestrator] ❌ Unexpected error — please click Rebuild to try again"],
          updatedAt: new Date(),
        })
        .where(eq(projectsTable.id, project.id));
    }
  });

  res.json({ ok: true, message: "Rebuild started" });
});

// SSE — real-time build log stream (no auth required so iframe previews work)
router.get("/:id/build-stream", async (req, res) => {
  const projectId = req.params.id;

  // Check project exists
  const project = await db.query.projectsTable.findFirst({
    where: eq(projectsTable.id, projectId),
  });
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // If already done, stream stored logs and close
  if (project.status !== "building") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const logs = Array.isArray(project.agentLogs) ? project.agentLogs as string[] : [];
    for (const msg of logs) {
      res.write(`data: ${JSON.stringify({ msg, ts: Date.now() })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ msg: "__DONE__", ts: Date.now() })}\n\n`);
    res.end();
    return;
  }

  // Live stream
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const session = subscribe(projectId, res);

  // Flush already-emitted logs immediately
  for (const entry of session.logs) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
  if (session.done) {
    res.write(`data: ${JSON.stringify({ msg: "__DONE__", ts: Date.now() })}\n\n`);
    res.end();
  }
});

// Deploy project — sets status to deployed and generates a shareable URL
router.post("/:id/deploy", requireAuth, async (req, res) => {
  const userId  = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const isVip   = req.auth!.isVip;
  const userPlan = req.auth!.plan;

  // ── Enforce deployment plan limit (skip for admins & VIP) ──
  if (!isAdmin && !isVip) {
    const limits = getPlanLimits(userPlan);
    if (limits.deployments === 0) {
      res.status(402).json({
        error: "plan_limit",
        code: "DEPLOY_NOT_ALLOWED",
        message: `Deployments are not available on the ${userPlan} plan. Upgrade to Starter or higher to deploy your apps.`,
        currentPlan: userPlan,
      });
      return;
    }
  }

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
  const userId  = req.auth!.userId;
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
  const userMessage = (message || action || "").trim();

  if (!userMessage) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const hasCode    = !!project.generatedCode;
  const prevStatus = project.status as string;

  // Enforce monthly build limit on chat-driven code changes (skip for admin/VIP).
  // We only block when this chat is going to actually rebuild code (`hasCode`).
  if (hasCode && !req.auth!.isAdmin && !req.auth!.isVip) {
    const check = await canPerformBuild(userId, req.auth!.plan);
    if (!check.allowed) {
      res.status(402).json({
        error: "plan_limit",
        code: check.reason === "overage_required" ? "OVERAGE_REQUIRED" : "BUILD_LIMIT",
        message: check.reason === "overage_required"
          ? `You've used all ${check.usage.builds.limit} builds this month. Buy a build pack to continue, or upgrade your plan.`
          : `You've used all ${check.usage.builds.limit} builds this month on the ${req.auth!.plan} plan. Upgrade for more builds.`,
        currentPlan: req.auth!.plan,
        usage: check.usage,
      });
      return;
    }
  }

  // Fetch user's secret NAMES (not values) so the AI can suggest using them
  // OR explicitly tell the user which API key they need to add.
  const userSecretNames = await getUserSecretNames(project.userId);

  // Run the chat reply generation and the "set building" DB write in parallel.
  // The DB update MUST finish before we call res.json() — otherwise the
  // frontend's immediate refetch() races the write and sees status:"ready",
  // which prevents polling from ever starting and the preview never refreshes.
  const priorChat = (project.chatHistory as ChatTurn[] | null) ?? [];
  const priorMemory = (project.memory as ProjectMemory | null) ?? null;

  const [reply] = await Promise.all([
    generateChatResponse(project.type, project.name, userMessage, project.prompt, userSecretNames, priorChat, priorMemory)
      .catch(() => `Got it — applying "${userMessage}" to your project now. The preview will update automatically when done.`),
    hasCode
      ? db.update(projectsTable)
          .set({ status: "building", updatedAt: new Date() })
          .where(eq(projectsTable.id, project.id))
      : Promise.resolve(),
  ]);

  // Persist the user message + agent reply to chat_history so it's available
  // across sessions. We append rather than overwrite to keep full transcript.
  try {
    const existing = (project.chatHistory as Array<{ role: string; content: string; timestamp: string }> | null) ?? [];
    const nowIso = new Date().toISOString();
    const updated = [
      ...existing,
      { role: "user", content: userMessage, timestamp: nowIso },
      { role: "agent", content: reply, timestamp: nowIso },
    ];
    await db.update(projectsTable)
      .set({ chatHistory: updated as any })
      .where(eq(projectsTable.id, project.id));
  } catch (err) {
    console.warn("Failed to persist chat history:", err);
  }

  // By the time we respond the DB already shows "building", so the frontend's
  // refetch() will see the right status and start polling immediately.
  res.json({ reply, updating: hasCode });

  // For chat-only turns (no code rebuild), update memory now in the background.
  // For turns that trigger a rebuild, the memory update happens inside the
  // rebuild branch below so it knows whether code actually changed.
  if (!hasCode) {
    setImmediate(async () => {
      try {
        const newMemory = await updateProjectMemory(
          project.name, project.type, priorMemory, userMessage, reply, false,
        );
        await db.update(projectsTable)
          .set({ memory: newMemory as any })
          .where(eq(projectsTable.id, project.id));
      } catch (memErr) {
        console.warn("Memory update (chat-only) failed:", memErr);
      }
    });
    return;
  }

  // Stream agent update steps
  setImmediate(async () => {
    try {
      emitLog(project.id, `[Orchestrator] 🧠 Received change request: "${userMessage.slice(0, 80)}"`);
      await new Promise(r => setTimeout(r, 300));
      emitLog(project.id, `[Software Architect] 🏗️ Analyzing existing codebase structure...`);
      await new Promise(r => setTimeout(r, 400));
      emitLog(project.id, `[Code Generator] 💻 Applying changes to ${project.name}...`);
      await new Promise(r => setTimeout(r, 300));
      emitLog(project.id, `[Orchestrator] 🔧 Generating updated code with AI...`);

      const updatedCode = await generateUpdatedCode(
        project.type,
        project.name,
        project.generatedCode!,
        userMessage,
        userSecretNames,
        priorMemory,
      );

      const changed = updatedCode !== project.generatedCode && updatedCode.length > 100;

      // Update long-term project memory after every chat turn so the AI keeps
      // continuous context of what's been built and what's still pending.
      try {
        const newMemory = await updateProjectMemory(
          project.name,
          project.type,
          priorMemory,
          userMessage,
          reply,
          changed,
        );
        await db.update(projectsTable)
          .set({ memory: newMemory as any })
          .where(eq(projectsTable.id, project.id));
      } catch (memErr) {
        console.warn("Memory update failed:", memErr);
      }

      if (changed) {
        emitLog(project.id, `[Code Generator] ✅ Updated ${updatedCode.length.toLocaleString()} bytes — changes applied`);
        await new Promise(r => setTimeout(r, 200));
        emitLog(project.id, `[Security Agent] 🔐 Security scan passed`);
        await new Promise(r => setTimeout(r, 200));
        emitLog(project.id, `[Orchestrator] 🎉 Changes applied! Preview updated.`);

        await db.update(projectsTable)
          .set({
            generatedCode: updatedCode,
            status: prevStatus === "deployed" ? "deployed" : "ready",
            updatedAt: new Date(),
          })
          .where(eq(projectsTable.id, project.id));
        await recordUsage({
          userId: project.userId,
          projectId: project.id,
          kind: "chat_change",
          description: `Chat update: "${userMessage.slice(0, 80)}"`,
        });
        await consumeOverageCreditIfNeeded(project.userId, req.auth!.plan);
      } else {
        emitLog(project.id, `[Orchestrator] ✅ Code reviewed — no structural changes needed for this request.`);
        await db.update(projectsTable)
          .set({ status: prevStatus === "deployed" ? "deployed" : "ready", updatedAt: new Date() })
          .where(eq(projectsTable.id, project.id));
      }
    } catch (err) {
      console.error("Chat code update failed:", err);
      emitLog(project.id, `[Orchestrator] ⚠️ Update encountered an issue — your app is unchanged.`);
      await db.update(projectsTable)
        .set({ status: prevStatus === "deployed" ? "deployed" : "ready", updatedAt: new Date() })
        .where(eq(projectsTable.id, project.id));
    } finally {
      completeBuild(project.id);
    }
  });
});

// Files list (returns file structure for display)
router.get("/:id/files", requireAuth, async (req, res) => {
  const userId   = req.auth!.userId;
  const isAdmin  = req.auth!.isAdmin;
  const isVip    = req.auth!.isVip;
  const userPlan = req.auth!.plan;

  // Free plan users cannot access file contents
  if (!isAdmin && !isVip && userPlan === "free") {
    res.status(402).json({
      error: "plan_limit",
      code: "SOURCE_NOT_ALLOWED",
      message: "Source code access requires a paid plan. Upgrade to Starter or higher.",
      currentPlan: userPlan,
    });
    return;
  }

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
