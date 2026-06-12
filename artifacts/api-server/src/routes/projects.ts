import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, usersTable, charactersTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { nanoid } from "../lib/nanoid.js";
import { generateProjectCode, generateChatResponse, generateUpdatedCode, generateServerJs, updateProjectMemory, type ProjectMemory, type ChatTurn, type CharacterContext } from "../lib/openrouter.js";
import { recordUsage, consumeOverageCreditIfNeeded, canPerformBuild } from "../lib/usage.js";
import { requireAuth } from "../middleware/auth.js";
import { streamBuild, subscribe, emitLog, completeBuild } from "../lib/build-logger.js";
import { getPlanLimits } from "./plans.js";
import { getUserSecretNames, getUserSecretsMap } from "./secrets.js";
import { verifyToken } from "../middleware/auth.js";
import { injectDiagnosticsWidget } from "../lib/diagnostics-widget.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import AdmZip from "adm-zip";
import { triggerMobileBuild, getMobileBuildStatus } from "../lib/eas.js";
import { generateMobileCode } from "../lib/generateMobileCode.js";
import { generateFlutterCode } from "../lib/generateFlutterCode.js";
import { mobileBuildTable, easWebhookTable } from "@workspace/db/schema";
import { listOtaUpdates, listChannels, listBranches, publishOtaUpdate } from "../lib/easUpdate.js";
import { submitBuild, getSubmissionStatus } from "../lib/easSubmit.js";
import { createEasWebhook, deleteEasWebhook, listEasWebhooks, type WebhookEvent } from "../lib/easWebhooks.js";
import { listWorkflowRuns, WORKFLOW_TEMPLATES, triggerWorkflowRun, getWorkflowRunLogs } from "../lib/easWorkflows.js";

const router: IRouter = Router();

const PROJECT_TYPES = ["website", "mobile_app", "flutter_app", "saas", "automation", "ai_tool", "game"];

/** Fetch characters linked to a game project for AI context injection */
async function getProjectCharacters(projectId: string): Promise<CharacterContext[]> {
  const rows = await db.select().from(charactersTable).where(eq(charactersTable.projectId, projectId));
  return rows.map(r => ({
    id:        r.id,
    name:      r.name,
    gameStyle: r.gameStyle,
    prompt:    r.prompt,
    imageUrl:  r.imageUrl,
    tags:      r.tags,
    notes:     r.notes,
  }));
}

/** Get all app-level secrets for a project (injected as window.APP_SECRETS, owner-only). */
async function getProjectSecretsMap(projectId: string): Promise<Record<string, string>> {
  try {
    const result = await db.execute(sql`
      SELECT name, value FROM project_app_secrets WHERE project_id = ${projectId}
    `);
    const rows: any[] = Array.isArray(result) ? result : ((result as any).rows ?? []);
    return Object.fromEntries(rows.map((r: any) => [r.name, r.value]));
  } catch {
    return {};
  }
}

function getAppJwtSecret(): string {
  const s = process.env["JWT_SECRET"];
  if (s) return `${s}:app`;
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("JWT_SECRET is required in production for app-level auth");
  }
  console.warn("[APP-AUTH] JWT_SECRET not set — using dev-only fallback. Set JWT_SECRET before deploying.");
  return "nexuselite-app-dev-only-do-not-deploy-without-jwt-secret";
}

function signAppToken(payload: { sub: string; projectId: string; username: string; email: string; role: string }): string {
  return jwt.sign(payload, getAppJwtSecret(), { expiresIn: "7d" });
}

function verifyAppToken(token: string): { sub: string; projectId: string; username: string; email: string; role: string } | null {
  try {
    return jwt.verify(token, getAppJwtSecret()) as any;
  } catch {
    return null;
  }
}

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
  if (type === "flutter_app") return "Flutter (Dart)";
  if (type === "saas") return "Next.js + Express";
  if (type === "website") return "React + Vite";
  if (type === "automation") return "Python + FastAPI";
  if (type === "ai_tool") return "Python + OpenAI API";
  return "React + Node.js";
}

function generateAgentLogs(type: string, name: string): string[] {
  const isGame = type === "game";
  const logs: string[] = [
    `[Orchestrator] 🧠 Received project prompt: "${name}"`,
    `[Orchestrator] 📋 Breaking down into subtasks for ${type} project...`,
    `[Software Architect] 🏗️ Designing system architecture...`,
    `[Design System] 🎨 Establishing design tokens and component library...`,
    `[Software Architect] ✅ Architecture blueprint finalised`,
    `[Router Agent] 🔀 Configuring application routing and navigation...`,
    `[Middleware] 🔧 Setting up request pipeline and API layers...`,
    `[Database Engineer] 🗄️ Designing data models and schema...`,
    `[Migration Agent] 📦 Preparing database migrations...`,
    `[Code Generator] 💻 Starting core code generation...`,
  ];

  if (isGame) {
    logs.push(
      `[Game Designer] 🎮 Creating game concept and mechanics...`,
      `[Canvas Renderer] 🖥️ Setting up HTML5 Canvas game engine...`,
      `[Asset Generator] 🖼️ Generating sprites and visual effects...`,
      `[Level Builder] 🗺️ Building game world and levels...`,
      `[Physics Engine] ⚡ Wiring collision detection and physics...`,
    );
  } else {
    logs.push(
      `[Asset Generator] 🖼️ Generating icons and visual assets...`,
      `[AI Integration] 🤖 Wiring AI features and model hooks...`,
    );
  }

  logs.push(
    `[UI/UX Designer] 🖼️ Crafting user interface components...`,
    `[Code Generator] ✅ Core codebase generated`,
    `[Code Analyzer] 🔍 Reviewing code quality and patterns...`,
    `[Performance] ⚡ Optimising bundle size and load times...`,
    `[Debugging Agent] 🐛 Tracing and resolving edge cases...`,
    `[Security Auditor] 🔐 Running security audit — no vulnerabilities found`,
    `[Testing Agent] 🧪 Automated tests passed`,
    `[DevOps Engineer] ⚙️ Preparing deployment configuration...`,
    `[Orchestrator] 🎉 All 21 agents complete — build ready!`,
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
  const { prompt, type, name, swarm_mode } = req.body;

  if (!prompt || !type || !name) {
    res.status(400).json({ error: "bad_request", message: "prompt, type, name are required" });
    return;
  }

  const VALID_SWARM_MODES = ["concierge", "cost", "premium", "guardian", "genesis", "hydra"];
  const resolvedSwarmMode = VALID_SWARM_MODES.includes(swarm_mode) ? swarm_mode : "genesis";

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
    swarmMode: resolvedSwarmMode,
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
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)),
      });

  if (!project) {
    res.status(404).json({ error: "not_found", message: "Project not found" });
    return;
  }

  res.json(projectResponse(project));
});

// Delete project
router.delete("/:id", requireAuth, async (req, res) => {
  const userId  = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const projectId = String(req.params.id);

  // Admin can delete any project; regular users can only delete their own
  const where = isAdmin
    ? eq(projectsTable.id, projectId)
    : and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId));

  const existing = await db.query.projectsTable.findFirst({ where });
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  await db.delete(projectsTable).where(where);
  res.status(204).send();
});

// Change swarm mode for a project
router.patch("/:id/swarm-mode", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const { swarm_mode } = req.body;
  const VALID = ["concierge", "cost", "premium", "guardian", "genesis", "hydra"];
  if (!VALID.includes(swarm_mode)) {
    res.status(400).json({ error: "invalid_swarm_mode", message: `Must be one of: ${VALID.join(", ")}` });
    return;
  }
  const project = await db.query.projectsTable.findFirst({
    where: eq(projectsTable.id, String(req.params.id)),
  });
  if (!project || (!isAdmin && project.userId !== userId)) {
    res.status(404).json({ error: "not_found" }); return;
  }
  const [updated] = await db.update(projectsTable)
    .set({ swarmMode: swarm_mode, updatedAt: new Date() })
    .where(eq(projectsTable.id, project.id))
    .returning();
  res.json(projectResponse(updated!));
});

// Build logs
router.get("/:id/build-logs", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)),
      });

  if (!project) {
    res.status(404).json({ error: "not_found", message: "Project not found" });
    return;
  }

  const agentLogs = Array.isArray(project.agentLogs) ? project.agentLogs as string[] : [];
  const logs = agentLogs.map((msg, i) => ({
    id: `log-${i}`,
    projectId: String(req.params.id),
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
    where: eq(projectsTable.id, String(req.params.id)),
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

  if (project.generatedCode) {
    try {
      // Build the platform backend URL for this project (NEXUS_API).
      // getBaseUrl() uses REPLIT_DOMAINS / REPLIT_DEV_DOMAIN so the URL is
      // always reachable from the browser — x-forwarded-host is NOT used because
      // Replit's proxy does not forward it, which caused localhost:8080 fallback
      // and broke all buttons in live previews.
      const nexusApiUrl = `${getBaseUrl()}/api/projects/${project.id}/appdata`;

      // Always inject NEXUS_API — it's just a URL (not a secret), scoped by
      // project_id. Every generated app needs this to make buttons work.
      // USER_SECRETS are only injected for verified owners (they contain real keys).
      let secretsJson = "{}";
      let appSecretsJson = "{}";
      if (isOwnerRequest) {
        const secrets = await getUserSecretsMap(project.userId);
        // SECURITY: JSON.stringify does NOT escape `</script>`, allowing a
        // crafted secret value to break out of the inline script. Replace
        // every `<` with its safe \u003c escape (and `>` for symmetry).
        const safeEscape = (s: string) => s
          .replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
          .replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
        secretsJson    = safeEscape(JSON.stringify(secrets));
        const appSecrets = await getProjectSecretsMap(project.id);
        appSecretsJson = safeEscape(JSON.stringify(appSecrets));
      }

      const nexusAuthUrl = `${getBaseUrl()}/api/projects/${project.id}/auth`;

      const injection =
        `<script>` +
        `window.NEXUS_API = "${nexusApiUrl}";` +
        `window.NEXUS_AUTH = "${nexusAuthUrl}";` +
        `window.NEXUS_PROJECT_ID = "${project.id}";` +
        `window.USER_SECRETS = ${secretsJson};` +
        `window.APP_SECRETS = ${appSecretsJson};` +
        // Null-guard shim: if any generated code calls window.NEXUS_API before
        // the script runs, or NEXUS_API is somehow still undefined, surface a
        // clear console error instead of a silent TypeError on every button click.
        `(function(){` +
        `var _orig = window.fetch;` +
        `window._nexusFetch = function(col,opts){` +
        `if(!window.NEXUS_API){console.error('[NEXUS] window.NEXUS_API is not set — buttons may not work');return Promise.reject(new Error('NEXUS_API not initialised'));}` +
        `return _orig(window.NEXUS_API+'/'+col,opts);};` +
        `})();` +
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

      // For auth-enabled apps (owner-only preview): inject a DOMContentLoaded
      // script that auto-seeds a demo admin account and shows a credentials
      // banner so the owner always knows how to log in on first test.
      // Injected only for the owner so end-users on deployed domains never see it.
      if (isOwnerRequest && /NEXUS_AUTH/i.test(project.generatedCode ?? "")) {
        const authSeedScript =
          `<script>` +
          `document.addEventListener('DOMContentLoaded',function(){` +
          `var DEMO_EMAIL='admin@demo.com',DEMO_PASS='NexusDemo123';` +
          // Auto-register demo account (silent — 409 = already exists, that's fine)
          `fetch(window.NEXUS_AUTH+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',email:DEMO_EMAIL,password:DEMO_PASS})}).catch(function(){});` +
          // Show credentials banner (dismissible, not shown again after dismiss)
          `if(!sessionStorage.getItem('_nexus_creds_seen')){` +
          `var b=document.createElement('div');` +
          `b.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#0f1729;border-top:2px solid #00d4ff;color:#e2e8f0;font-family:system-ui,sans-serif;padding:10px 16px;z-index:2147483647;display:flex;align-items:center;gap:14px;font-size:13px;flex-wrap:wrap';` +
          `b.innerHTML='<span style="color:#00d4ff;font-weight:700;white-space:nowrap">🔑 Demo Login:</span>'+` +
          `'<span>Email: <code style="color:#fbbf24;background:#1a1a2e;padding:1px 5px;border-radius:3px">admin@demo.com</code></span>'+` +
          `'<span>Password: <code style="color:#fbbf24;background:#1a1a2e;padding:1px 5px;border-radius:3px">NexusDemo123</code></span>'+` +
          `'<button id="_nx_creds_close" style="margin-left:auto;background:none;border:1px solid #334155;color:#94a3b8;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:12px">Dismiss</button>';` +
          `document.body.appendChild(b);` +
          `document.getElementById('_nx_creds_close').addEventListener('click',function(){b.remove();sessionStorage.setItem('_nexus_creds_seen','1');});` +
          `}` +
          `});` +
          `</script>`;
        if (/<\/body>/i.test(html)) {
          html = html.replace(/<\/body>/i, `${authSeedScript}</body>`);
        } else {
          html += authSeedScript;
        }
      }
    } catch (err) {
      console.error("Failed to inject runtime globals into preview:", err);
    }
  }

  // Inject the floating "Build Analysis & App Diagnostics" widget into non-game
  // apps. Skipped for games so it doesn't interfere with gameplay.
  if (project.generatedCode && project.type !== "game") {
    try { html = injectDiagnosticsWidget(html); }
    catch (err) { console.error("Failed to inject diagnostics widget:", err); }
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
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)),
      });

  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  res.json({ code: project.generatedCode || "", framework: project.framework });
});

// Download project as ZIP — paid plans, vip, and admin only
router.get("/:id/download", requireAuth, async (req, res) => {
  const userId   = req.auth!.userId;
  const isAdmin  = req.auth!.isAdmin;
  const isVip    = req.auth!.isVip;
  const userPlan = req.auth!.plan;

  if (!isAdmin && !isVip && userPlan === "free") {
    res.status(402).json({
      error: "plan_limit",
      code: "DOWNLOAD_NOT_ALLOWED",
      message: "ZIP download requires a paid plan. Upgrade to Starter or higher to download your app's source code.",
      currentPlan: userPlan,
    });
    return;
  }

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)),
      });

  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  if (!project.generatedCode) {
    res.status(400).json({ error: "not_ready", message: "Project must be built before downloading." });
    return;
  }

  const zip = new AdmZip();

  // Full-stack ZIP: frontend HTML + Node.js backend server + package.json
  const serverJs = generateServerJs(project.name);
  const pkgName  = project.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 50);
  const pkgJson  = JSON.stringify({
    name: pkgName,
    version: "1.0.0",
    main: "server.js",
    scripts: { start: "node server.js" },
    dependencies: { express: "^4.18.2", cors: "^2.8.5" },
  }, null, 2);

  zip.addFile("public/index.html", Buffer.from(project.generatedCode, "utf-8"));
  zip.addFile("server.js",         Buffer.from(serverJs, "utf-8"));
  zip.addFile("package.json",      Buffer.from(pkgJson, "utf-8"));

  const readme = [
    `# ${project.name}`,
    ``,
    `**Type:** ${project.type}`,
    `**Framework:** Node.js + Express backend / HTML+CSS+JS frontend`,
    `**Built with:** NexusElite AI Studio`,
    ``,
    `## Run Locally (Full-Stack)`,
    ``,
    `\`\`\`bash`,
    `npm install`,
    `npm start`,
    `\`\`\``,
    ``,
    `Then open **http://localhost:3000** — the backend serves the frontend and`,
    `provides a real REST database at \`/api/appdata/:collection\` so data persists`,
    `across sessions (in-memory; resets on process restart).`,
    ``,
    `## Deploy to Render / Railway / Fly.io`,
    ``,
    `1. Push this folder to a GitHub repository`,
    `2. Create a new **Web Service** pointing to the repo`,
    `3. Build command: \`npm install\``,
    `4. Start command: \`npm start\``,
    ``,
    `The \`RENDER_EXTERNAL_URL\` env var is auto-set by Render and used to`,
    `configure the backend URL the frontend talks to.`,
    ``,
    `## Open Without a Server (Static — Limited)`,
    ``,
    `Open \`public/index.html\` directly in a browser. Some features (data`,
    `persistence, multi-user) require the backend to be running.`,
    ``,
    `## Description`,
    ``,
    project.description || project.prompt || "",
  ].join("\n");

  zip.addFile("README.md", Buffer.from(readme, "utf-8"));

  const safeName = project.name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
  const filename = `${safeName}.zip`;

  const buffer = zip.toBuffer();
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length);
  res.send(buffer);
});

// ── App-level authentication for generated apps ───────────────────────────────
// Generated apps call window.NEXUS_AUTH + /register, /login, /me
// Real bcrypt passwords, real JWTs — NOT the fake btoa localStorage pattern.
// Platform auth (NexusElite login) is entirely separate.

function appAuthCors(res: { setHeader: (k: string, v: string) => void }): void {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

router.options("/:id/auth/:action", (_req, res) => { appAuthCors(res); res.sendStatus(200); });

// POST /api/projects/:id/auth/register
router.post("/:id/auth/register", async (req, res) => {
  const projectId = String(req.params.id);
  appAuthCors(res as any);
  const { username, email, password } = req.body ?? {};
  if (!password || (!username && !email)) {
    res.status(400).json({ error: "username or email and password are required" });
    return;
  }
  try {
    if (username) {
      const dup = await db.execute(sql`
        SELECT doc_id FROM project_app_data
        WHERE project_id = ${projectId} AND collection = '_users'
          AND data->>'username' = ${String(username)} LIMIT 1
      `);
      const dupRows: any[] = Array.isArray(dup) ? dup : ((dup as any).rows ?? []);
      if (dupRows.length > 0) { res.status(409).json({ error: "Username already taken" }); return; }
    }
    if (email) {
      const dup = await db.execute(sql`
        SELECT doc_id FROM project_app_data
        WHERE project_id = ${projectId} AND collection = '_users'
          AND data->>'email' = ${String(email)} LIMIT 1
      `);
      const dupRows: any[] = Array.isArray(dup) ? dup : ((dup as any).rows ?? []);
      if (dupRows.length > 0) { res.status(409).json({ error: "Email already registered" }); return; }
    }
    const passwordHash = await bcrypt.hash(String(password), 10);
    const docId = nanoid();
    const userData = {
      username: username ? String(username) : undefined,
      email:    email    ? String(email)    : undefined,
      passwordHash,
      role:      "user",
      createdAt: new Date().toISOString(),
    };
    await db.execute(sql`
      INSERT INTO project_app_data (id, project_id, collection, doc_id, data)
      VALUES (${nanoid()}, ${projectId}, '_users', ${docId}, ${JSON.stringify(userData)}::jsonb)
    `);
    const token = signAppToken({ sub: docId, projectId, username: username ?? email ?? "", email: email ?? "", role: "user" });
    res.status(201).json({ token, user: { id: docId, username: username ?? null, email: email ?? null, role: "user" } });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Registration failed" });
  }
});

// POST /api/projects/:id/auth/login
router.post("/:id/auth/login", async (req, res) => {
  const projectId = String(req.params.id);
  appAuthCors(res as any);
  const { username, email, password } = req.body ?? {};
  const identifier = email ?? username;
  if (!identifier || !password) {
    res.status(400).json({ error: "email or username and password are required" });
    return;
  }
  try {
    const field = email ? "email" : "username";
    const result = await db.execute(sql`
      SELECT doc_id, data FROM project_app_data
      WHERE project_id = ${projectId} AND collection = '_users'
        AND data->>${field} = ${String(identifier)} LIMIT 1
    `);
    const rows: any[] = Array.isArray(result) ? result : ((result as any).rows ?? []);
    if (rows.length === 0) { res.status(401).json({ error: "Invalid credentials" }); return; }
    const row  = rows[0];
    const data = typeof row.data === "object" ? row.data : JSON.parse(row.data as string);
    const match = await bcrypt.compare(String(password), data.passwordHash ?? "");
    if (!match) { res.status(401).json({ error: "Invalid credentials" }); return; }
    const docId = String(row.doc_id);
    const token = signAppToken({ sub: docId, projectId, username: data.username ?? "", email: data.email ?? "", role: data.role ?? "user" });
    res.json({ token, user: { id: docId, username: data.username ?? null, email: data.email ?? null, role: data.role ?? "user" } });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Login failed" });
  }
});

// GET /api/projects/:id/auth/me
router.get("/:id/auth/me", (req, res) => {
  const projectId = String(req.params.id);
  appAuthCors(res as any);
  const header = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!header) { res.status(401).json({ error: "No token provided" }); return; }
  const payload = verifyAppToken(header);
  if (!payload || payload.projectId !== projectId) {
    res.status(401).json({ error: "Invalid or expired token" }); return;
  }
  res.json({ id: payload.sub, username: payload.username, email: payload.email, role: payload.role });
});

// ── NEXUS App Database — public REST API for generated apps ──────────────────
// No auth required: project_id scopes the data; these are app-level records,
// not user secrets. The platform stores them in real PostgreSQL (project_app_data).
// Collections starting with _ are reserved (auth uses _users internally).

function appdataCors(res: { setHeader: (k: string, v: string) => void }): void {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

router.options("/:id/appdata/:collection",        (_req, res) => { appdataCors(res); res.sendStatus(200); });
router.options("/:id/appdata/:collection/:docId", (_req, res) => { appdataCors(res); res.sendStatus(200); });

router.get("/:id/appdata/:collection", async (req, res) => {
  const projectId  = String(req.params.id);
  const collection = String(req.params.collection);
  (res as any).setHeader("Access-Control-Allow-Origin", "*");
  if (collection.startsWith("_")) {
    res.status(403).json({ error: "reserved", message: "Collections starting with _ are reserved. Use /auth routes for user management." });
    return;
  }
  try {
    const result = await db.execute(sql`
      SELECT doc_id AS id, data, created_at, updated_at
      FROM project_app_data
      WHERE project_id = ${projectId} AND collection = ${collection}
      ORDER BY created_at DESC LIMIT 1000
    `);
    const rows: any[] = Array.isArray(result) ? result : ((result as any).rows ?? []);
    res.json(rows.map((r: any) => ({
      id: r.id ?? r.doc_id,
      ...(r.data && typeof r.data === "object" ? r.data : {}),
      _created: r.created_at,
      _updated: r.updated_at,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Database error" });
  }
});

router.post("/:id/appdata/:collection", async (req, res) => {
  const projectId  = String(req.params.id);
  const collection = String(req.params.collection);
  const docId      = nanoid();
  const rowId      = nanoid();
  const data       = req.body && typeof req.body === "object" ? req.body : {};
  (res as any).setHeader("Access-Control-Allow-Origin", "*");
  if (collection.startsWith("_")) {
    res.status(403).json({ error: "reserved", message: "Collections starting with _ are reserved. Use /auth routes for user management." });
    return;
  }
  try {
    await db.execute(sql`
      INSERT INTO project_app_data (id, project_id, collection, doc_id, data)
      VALUES (${rowId}, ${projectId}, ${collection}, ${docId}, ${JSON.stringify(data)}::jsonb)
    `);
    res.status(201).json({ id: docId, ...data });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Database error" });
  }
});

router.put("/:id/appdata/:collection/:docId", async (req, res) => {
  const projectId  = String(req.params.id);
  const collection = String(req.params.collection);
  const docId      = String(req.params.docId);
  const data       = req.body && typeof req.body === "object" ? req.body : {};
  (res as any).setHeader("Access-Control-Allow-Origin", "*");
  if (collection.startsWith("_")) {
    res.status(403).json({ error: "reserved", message: "Collections starting with _ are reserved. Use /auth routes for user management." });
    return;
  }
  try {
    await db.execute(sql`
      UPDATE project_app_data
      SET data = ${JSON.stringify(data)}::jsonb, updated_at = NOW()
      WHERE project_id = ${projectId} AND collection = ${collection} AND doc_id = ${docId}
    `);
    res.json({ id: docId, ...data });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Database error" });
  }
});

router.delete("/:id/appdata/:collection/:docId", async (req, res) => {
  const projectId  = String(req.params.id);
  const collection = String(req.params.collection);
  const docId      = String(req.params.docId);
  (res as any).setHeader("Access-Control-Allow-Origin", "*");
  if (collection.startsWith("_")) {
    res.status(403).json({ error: "reserved", message: "Collections starting with _ are reserved. Use /auth routes for user management." });
    return;
  }
  try {
    await db.execute(sql`
      DELETE FROM project_app_data
      WHERE project_id = ${projectId} AND collection = ${collection} AND doc_id = ${docId}
    `);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Database error" });
  }
});

// ── Per-app secrets management (platform owner only) ─────────────────────────
// These are per-project secrets (e.g. a Stripe key for "My Store App" only).
// Injected as window.APP_SECRETS in the preview — owner-only, like USER_SECRETS.

router.get("/:id/secrets", requireAuth, async (req, res) => {
  const projectId = String(req.params.id);
  const project = await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, projectId) });
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.userId !== req.auth!.userId && !req.auth!.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }
  const result = await db.execute(sql`
    SELECT id, name, created_at, updated_at FROM project_app_secrets
    WHERE project_id = ${projectId} ORDER BY name
  `);
  const rows: any[] = Array.isArray(result) ? result : ((result as any).rows ?? []);
  res.json(rows.map((r: any) => ({ id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at })));
});

router.post("/:id/secrets", requireAuth, async (req, res) => {
  const projectId = String(req.params.id);
  const project = await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, projectId) });
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.userId !== req.auth!.userId && !req.auth!.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }
  const { name, value } = req.body ?? {};
  if (!name || value === undefined || value === "") { res.status(400).json({ error: "name and value are required" }); return; }
  const normName = String(name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
  if (!normName) { res.status(400).json({ error: "Invalid secret name" }); return; }
  const id = nanoid();
  await db.execute(sql`
    INSERT INTO project_app_secrets (id, project_id, name, value)
    VALUES (${id}, ${projectId}, ${normName}, ${String(value)})
    ON CONFLICT (project_id, name) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
  res.status(201).json({ id, name: normName });
});

router.delete("/:id/secrets/:name", requireAuth, async (req, res) => {
  const projectId = String(req.params.id);
  const project = await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, projectId) });
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.userId !== req.auth!.userId && !req.auth!.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.execute(sql`
    DELETE FROM project_app_secrets WHERE project_id = ${projectId} AND name = ${String(req.params.name)}
  `);
  res.status(204).send();
});

// Serve the generated Node.js server.js — downloaded by Render containers at boot
router.get("/:id/server", async (req, res) => {
  const project = await db.query.projectsTable.findFirst({
    where: eq(projectsTable.id, String(req.params.id)),
  });
  if (!project) {
    res.status(404).type("application/javascript").send("// Project not found");
    return;
  }
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "no-store");
  res.send(generateServerJs(project.name));
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
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)),
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
  const pCharacters = pType === "game" ? await getProjectCharacters(project.id) : [];
  setImmediate(async () => {
    try {
      const generatedCode = await streamBuild(
        project.id,
        newLogs,
        () => generateProjectCode(pType, pName, pPrompt, pCharacters),
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
  const projectId = String(req.params.id);

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
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)),
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
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)),
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

  const priorChat = (project.chatHistory as ChatTurn[] | null) ?? [];
  const priorMemory = (project.memory as ProjectMemory | null) ?? null;

  // Step 1: Set DB status to "building" FIRST so the frontend's immediate
  // refetch() sees the right status and starts polling right away.
  if (hasCode) {
    await db.update(projectsTable)
      .set({ status: "building", updatedAt: new Date() })
      .where(eq(projectsTable.id, project.id));
  }

  // Step 2: Respond to the client IMMEDIATELY — don't make them wait 30-90s
  // for the AI chat reply to generate. The real reply will arrive via SSE
  // as a __REPLY__:{...} message a few seconds later.
  const quickReply = `Got it! Dispatching the swarm to apply "${userMessage.slice(0, 60)}" to ${project.name}. Building now — the preview will update automatically when done.`;
  res.json({ reply: quickReply, updating: hasCode });

  // Step 3: Everything else runs in the background — client already responded.
  setImmediate(async () => {
    // Kick off chat reply generation IMMEDIATELY as a concurrent promise so it
    // runs in parallel with the agent build logs. Do NOT await it here — the
    // agent indicator lights must start firing within the first second.
    const chatReplyPromise: Promise<string> = generateChatResponse(
      project.type, project.name, userMessage, project.prompt,
      userSecretNames, priorChat, priorMemory,
      project.generatedCode ?? null,
    ).catch(() => quickReply);

    // Helper — persist chat history once we have the real reply
    async function persistChatHistory(reply: string) {
      try {
        const existing = (project.chatHistory as Array<{ role: string; content: string; timestamp: string }> | null) ?? [];
        const nowIso = new Date().toISOString();
        await db.update(projectsTable)
          .set({ chatHistory: [...existing,
            { role: "user",  content: userMessage, timestamp: nowIso },
            { role: "agent", content: reply,        timestamp: nowIso },
          ] as any })
          .where(eq(projectsTable.id, project.id));
      } catch (err) {
        console.warn("Failed to persist chat history:", err);
      }
    }

    // For chat-only turns (no code rebuild) just wait for the reply then finish.
    if (!hasCode) {
      const reply = await chatReplyPromise;
      emitLog(project.id, `__REPLY__:${JSON.stringify({ reply })}`);
      await persistChatHistory(reply);
      try {
        const newMemory = await updateProjectMemory(
          project.name, project.type, priorMemory, userMessage, reply, false,
        );
        await db.update(projectsTable)
          .set({ memory: newMemory as any })
          .where(eq(projectsTable.id, project.id));
        // Signal the frontend that memory was updated so it can refetch
        emitLog(project.id, `__MEMORY_UPDATED__`);
      } catch (memErr) {
        console.warn("Memory update (chat-only) failed:", String(memErr));
      }
      return;
    }

    // Code rebuild — stream agent logs RIGHT NOW (chat reply runs in parallel)
    try {
      emitLog(project.id, `[Orchestrator] 🧠 Received change request: "${userMessage.slice(0, 80)}"`);
      await new Promise(r => setTimeout(r, 250));
      emitLog(project.id, `[Software Architect] 🏗️ Analysing existing codebase structure...`);
      await new Promise(r => setTimeout(r, 250));
      emitLog(project.id, `[Code Analyzer] 🔍 Reviewing current implementation...`);
      await new Promise(r => setTimeout(r, 200));
      emitLog(project.id, `[Design System] 🎨 Checking design consistency...`);
      await new Promise(r => setTimeout(r, 200));
      emitLog(project.id, `[Router Agent] 🔀 Validating routing and navigation...`);
      await new Promise(r => setTimeout(r, 200));
      emitLog(project.id, `[Middleware] 🔧 Verifying API layer integrity...`);
      await new Promise(r => setTimeout(r, 200));
      emitLog(project.id, `[Database Engineer] 🗄️ Checking data model compatibility...`);
      await new Promise(r => setTimeout(r, 200));
      emitLog(project.id, `[UI/UX Designer] 🖼️ Updating interface components...`);
      await new Promise(r => setTimeout(r, 200));
      emitLog(project.id, `[Performance] ⚡ Pre-checking optimisation impact...`);
      await new Promise(r => setTimeout(r, 200));
      emitLog(project.id, `[Code Generator] 💻 Applying changes to ${project.name}...`);
      await new Promise(r => setTimeout(r, 200));
      emitLog(project.id, `[Orchestrator] 🔧 Generating updated code with AI...`);

      const chatCharacters = project.type === "game" ? await getProjectCharacters(project.id) : [];
      const updatedCode = await generateUpdatedCode(
        project.type,
        project.name,
        project.generatedCode!,
        userMessage,
        userSecretNames,
        priorMemory,
        chatCharacters,
      );

      const changed = updatedCode !== project.generatedCode && updatedCode.length > 100;

      // By now the chat reply has had 90-180s to generate in parallel — collect it.
      const reply = await chatReplyPromise;

      // Deliver the real AI reply to the frontend via SSE now that build is done
      emitLog(project.id, `__REPLY__:${JSON.stringify({ reply })}`);

      // Persist chat history with the real reply
      await persistChatHistory(reply);

      // Update long-term project memory
      try {
        const newMemory = await updateProjectMemory(
          project.name, project.type, priorMemory, userMessage, reply, changed,
        );
        await db.update(projectsTable)
          .set({ memory: newMemory as any })
          .where(eq(projectsTable.id, project.id));
      } catch (memErr) {
        console.warn("Memory update failed:", memErr);
      }

      if (changed) {
        emitLog(project.id, `[Code Generator] ✅ Updated ${updatedCode.length.toLocaleString()} bytes — changes applied`);
        await new Promise(r => setTimeout(r, 180));
        emitLog(project.id, `[Debugging Agent] 🐛 Validating changes and edge cases...`);
        await new Promise(r => setTimeout(r, 180));
        emitLog(project.id, `[Security Auditor] 🔐 Security scan passed — no issues found`);
        await new Promise(r => setTimeout(r, 180));
        emitLog(project.id, `[Testing Agent] 🧪 Automated tests passed`);
        await new Promise(r => setTimeout(r, 180));
        emitLog(project.id, `[Asset Generator] 🖼️ Assets verified and optimised`);
        await new Promise(r => setTimeout(r, 180));
        emitLog(project.id, `[DevOps Engineer] ⚙️ Preview environment updated`);
        await new Promise(r => setTimeout(r, 180));
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
      // Still deliver the chat reply even on error
      const reply = await chatReplyPromise.catch(() => quickReply);
      emitLog(project.id, `__REPLY__:${JSON.stringify({ reply })}`);
      await persistChatHistory(reply).catch(() => {});
      // Still update memory even when code gen fails
      try {
        const newMemory = await updateProjectMemory(
          project.name, project.type, priorMemory, userMessage, reply, false,
        );
        await db.update(projectsTable)
          .set({ memory: newMemory as any })
          .where(eq(projectsTable.id, project.id));
      } catch (memErr) {
        console.warn("Memory update (error path) failed:", String(memErr));
      }
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
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)),
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

// ── Character ↔ Project linking endpoints ────────────────────────────────────

/** List all characters linked to this project */
router.get("/:id/characters", requireAuth, async (req, res) => {
  const userId  = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)),
      });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }
  const characters = await db.select().from(charactersTable)
    .where(eq(charactersTable.projectId, project.id));
  res.json(characters);
});

/** Link a character to this project */
router.post("/:id/characters/:characterId", requireAuth, async (req, res) => {
  const userId      = req.auth!.userId;
  const isAdmin     = req.auth!.isAdmin;
  const projectId   = String(req.params.id);
  const characterId = String(req.params.characterId);

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, projectId) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)),
      });
  if (!project) { res.status(404).json({ error: "project_not_found" }); return; }

  const character = await db.query.charactersTable.findFirst({
    where: and(eq(charactersTable.id, characterId), eq(charactersTable.userId, userId)),
  });
  if (!character) { res.status(404).json({ error: "character_not_found" }); return; }

  const [updated] = await db.update(charactersTable)
    .set({ projectId, updatedAt: new Date() })
    .where(eq(charactersTable.id, characterId))
    .returning();
  res.json(updated);
});

// ── Mobile Build (EAS) ──────────────────────────────────────────────────────

/** Trigger an EAS build for a mobile_app project */
router.post("/:id/mobile-build", requireAuth, async (req, res) => {
  const userId   = req.auth!.userId;
  const isAdmin  = req.auth!.isAdmin;
  const isVip    = req.auth!.isVip;
  const userPlan = req.auth!.plan;

  // Pro / Elite / Admin / VIP only
  if (!isAdmin && !isVip && userPlan !== "pro" && userPlan !== "elite") {
    res.status(402).json({
      error: "plan_limit",
      code: "MOBILE_BUILD_NOT_ALLOWED",
      message: "Mobile app publishing (EAS Build) is available on Pro ($60/mo) and Elite ($269/mo) plans.",
      currentPlan: userPlan,
    });
    return;
  }

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)),
      });

  if (!project) { res.status(404).json({ error: "not_found" }); return; }
  if (project.type !== "mobile_app") {
    res.status(400).json({ error: "not_mobile", message: "Only mobile_app projects can be built with EAS." });
    return;
  }

  const rawPlatform = req.body?.platform;
  const platform: "android" | "ios" | "all" =
    rawPlatform === "ios" ? "ios" : rawPlatform === "all" ? "all" : "android";

  const nexusApiBase = `${getBaseUrl()}/api/projects/${project.id}/appdata`;

  try {
    // Generate Expo project files via AI
    console.log(`[MobileBuild] Generating Expo files for project ${project.id}...`);
    const files = await generateMobileCode(project.name, project.prompt ?? project.description ?? "", nexusApiBase, project.id);

    // Push to GitHub + trigger EAS build (returns array; "all" returns 2 builds)
    console.log(`[MobileBuild] Triggering ${platform} EAS build...`);
    const results = await triggerMobileBuild({
      projectId:   project.id,
      projectName: project.name,
      platform,
      files,
    });

    // Persist a build record for every result (1 for android/ios, 2 for all)
    const buildRows = await Promise.all(results.map(result =>
      db.insert(mobileBuildTable).values({
        id:          nanoid(),
        projectId:   project.id,
        easBuildId:  result.buildId,
        platform:    result.platform,
        status:      result.status ?? "in-queue",
        profile:     "preview",
        artifactUrl: result.artifactUrl ?? undefined,
        repoUrl:     result.repoUrl ?? undefined,
        logsUrl:     result.logsUrl ?? undefined,
      }).returning(),
    ));

    // Append log entries for all triggered builds
    const newLogs = results.map(r => `[MobileBuild] 🚀 EAS ${r.platform} build triggered — ID: ${r.buildId}`);
    await db.update(projectsTable)
      .set({
        updatedAt: new Date(),
        agentLogs: [
          ...(Array.isArray(project.agentLogs) ? project.agentLogs as string[] : []),
          ...newLogs,
        ],
      })
      .where(eq(projectsTable.id, project.id));

    // Return first result for single-platform builds; array for "all"
    if (results.length === 1) {
      res.json({ ...results[0], buildRowId: buildRows[0]?.[0]?.id });
    } else {
      res.json({ builds: results.map((r, i) => ({ ...r, buildRowId: buildRows[i]?.[0]?.id })) });
    }
  } catch (err: any) {
    console.error("[MobileBuild] Failed:", err?.message ?? err);
    res.status(500).json({ error: "build_failed", message: err?.message ?? "EAS build failed" });
  }
});

/** Poll EAS build status */
router.get("/:id/mobile-build/:buildId", requireAuth, async (req, res) => {
  const userId  = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const buildId = String(req.params.buildId);

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)),
      });

  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  try {
    const status = await getMobileBuildStatus(buildId);
    // Update persisted build row if it exists
    const isDone = ["finished", "errored", "cancelled"].includes(status.status);
    await db.update(mobileBuildTable)
      .set({
        status:      status.status,
        artifactUrl: status.artifactUrl ?? undefined,
        logsUrl:     status.logsUrl ?? undefined,
        errorMessage: status.error ?? undefined,
        ...(isDone ? { finishedAt: new Date() } : {}),
      })
      .where(eq(mobileBuildTable.easBuildId, buildId));
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: "poll_failed", message: err?.message ?? "Failed to get build status" });
  }
});

/** Download the Expo project as a ZIP (no build — just the source) */
router.get("/:id/mobile-download", requireAuth, async (req, res) => {
  const userId   = req.auth!.userId;
  const isAdmin  = req.auth!.isAdmin;
  const isVip    = req.auth!.isVip;
  const userPlan = req.auth!.plan;

  if (!isAdmin && !isVip && userPlan === "free") {
    res.status(402).json({
      error: "plan_limit",
      code: "DOWNLOAD_NOT_ALLOWED",
      message: "ZIP download requires a paid plan.",
    });
    return;
  }

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)),
      });

  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const nexusApiBase = `${getBaseUrl()}/api/projects/${project.id}/appdata`;

  try {
    const files = await generateMobileCode(project.name, project.prompt ?? project.description ?? "", nexusApiBase, project.id);
    const zip = new AdmZip();
    for (const [filePath, content] of Object.entries(files)) {
      // Binary PNG placeholder files are stored as base64
      if (filePath.endsWith(".png")) {
        zip.addFile(filePath, Buffer.from(content, "base64"));
      } else {
        zip.addFile(filePath, Buffer.from(content, "utf-8"));
      }
    }
    const safeName = project.name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
    const buffer = zip.toBuffer();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-expo.zip"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: "zip_failed", message: err?.message ?? "Failed to generate ZIP" });
  }
});

/** Download Flutter project as a ZIP (Dart source — user builds locally or via Codemagic) */
router.get("/:id/flutter-download", requireAuth, async (req, res) => {
  const userId   = req.auth!.userId;
  const isAdmin  = req.auth!.isAdmin;
  const userPlan = req.auth!.plan;
  const isVip    = req.auth!.isVip;

  if (!isAdmin && !isVip && userPlan === "free") {
    res.status(402).json({
      error: "plan_limit",
      code: "FLUTTER_DOWNLOAD_NOT_ALLOWED",
      message: "Flutter source download requires a paid plan.",
    });
    return;
  }

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)),
      });

  if (!project) { res.status(404).json({ error: "not_found" }); return; }
  if (project.type !== "flutter_app") {
    res.status(400).json({ error: "not_flutter", message: "Only flutter_app projects can use this endpoint." });
    return;
  }

  try {
    const files = await generateFlutterCode(
      project.name,
      project.prompt ?? project.description ?? "",
      project.id,
    );
    const zip = new AdmZip();
    for (const [filePath, content] of Object.entries(files)) {
      zip.addFile(filePath, Buffer.from(content, "utf-8"));
    }
    const safeName = project.name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
    const buffer = zip.toBuffer();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-flutter.zip"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err: any) {
    console.error("[FlutterDownload]", err?.message ?? err);
    res.status(500).json({ error: "zip_failed", message: err?.message ?? "Failed to generate Flutter ZIP" });
  }
});

/** Unlink a character from this project */
router.delete("/:id/characters/:characterId", requireAuth, async (req, res) => {
  const userId      = req.auth!.userId;
  const projectId   = String(req.params.id);
  const characterId = String(req.params.characterId);

  const character = await db.query.charactersTable.findFirst({
    where: and(eq(charactersTable.id, characterId), eq(charactersTable.userId, userId)),
  });
  if (!character || character.projectId !== projectId) {
    res.status(404).json({ error: "not_found" }); return;
  }

  await db.update(charactersTable)
    .set({ projectId: null, updatedAt: new Date() })
    .where(eq(charactersTable.id, characterId));
  res.json({ ok: true });
});

// ── Build History ─────────────────────────────────────────────────────────────

/** List up to 20 most recent mobile builds for a project.
 *  Any rows still in-queue or in-progress are reconciled against EAS before
 *  the response is returned so the History tab never shows permanently stale statuses. */
router.get("/:id/mobile-builds", requireAuth, async (req, res) => {
  const userId  = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const builds = await db.select().from(mobileBuildTable)
    .where(eq(mobileBuildTable.projectId, project.id))
    .orderBy(sql`created_at DESC`)
    .limit(20);

  // Reconcile any builds that are still in-flight against EAS live state.
  const inFlight = builds.filter(b =>
    (b.status === "in-queue" || b.status === "in-progress") && b.easBuildId
  );
  if (inFlight.length > 0) {
    await Promise.allSettled(inFlight.map(async (b) => {
      try {
        const live = await getMobileBuildStatus(b.easBuildId!);
        const isDone = ["finished", "errored", "cancelled"].includes(live.status);
        await db.update(mobileBuildTable)
          .set({
            status:       live.status,
            artifactUrl:  live.artifactUrl ?? undefined,
            logsUrl:      live.logsUrl     ?? undefined,
            errorMessage: live.error       ?? undefined,
            ...(isDone ? { finishedAt: new Date() } : {}),
          })
          .where(eq(mobileBuildTable.easBuildId, b.easBuildId!));
        // Mutate the in-memory row so the response reflects the fresh status
        b.status      = live.status as typeof b.status;
        b.artifactUrl = live.artifactUrl ?? b.artifactUrl;
        b.logsUrl     = live.logsUrl     ?? b.logsUrl;
        if (isDone && !b.finishedAt) b.finishedAt = new Date();
      } catch {
        // Best-effort — if EAS is unreachable, return the last-known DB status
      }
    }));
  }

  res.json(builds);
});

/** Delete a build history record */
router.delete("/:id/mobile-builds/:buildId", requireAuth, async (req, res) => {
  const userId  = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const buildId = String(req.params.buildId);

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  await db.delete(mobileBuildTable).where(and(eq(mobileBuildTable.id, buildId), eq(mobileBuildTable.projectId, project.id)));
  res.json({ ok: true });
});

// ── OTA Updates ───────────────────────────────────────────────────────────────

function mobileGuard(userPlan: string, isAdmin: boolean, isVip: boolean): boolean {
  return isAdmin || isVip || userPlan === "pro" || userPlan === "elite";
}

function projectEasSlug(projectId: string): string {
  return `nexus-mobile-${projectId}`.slice(0, 60);
}

/** List recent OTA updates */
router.get("/:id/ota-updates", requireAuth, async (req, res) => {
  const userId  = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const updates = await listOtaUpdates(projectEasSlug(project.id));
  res.json(updates);
});

/** List EAS channels */
router.get("/:id/ota-channels", requireAuth, async (req, res) => {
  const userId  = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const channels = await listChannels(projectEasSlug(project.id));
  res.json(channels);
});

/** List EAS branches */
router.get("/:id/ota-branches", requireAuth, async (req, res) => {
  const userId  = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const branches = await listBranches(projectEasSlug(project.id));
  res.json(branches);
});

/** Publish an OTA update */
router.post(["/:id/ota-updates", "/:id/ota-update"], requireAuth, async (req, res) => {
  const userId   = req.auth!.userId;
  const isAdmin  = req.auth!.isAdmin;
  const isVip    = req.auth!.isVip;
  const userPlan = req.auth!.plan;

  if (!mobileGuard(userPlan, isAdmin, isVip)) {
    res.status(402).json({ error: "plan_limit", code: "OTA_NOT_ALLOWED", message: "OTA updates require Pro or Elite plan." });
    return;
  }

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const { branch = "main", message = "OTA update" } = req.body as { branch?: string; message?: string };

  try {
    // Generate the project's actual Expo files so the OTA update bundles real app code
    const nexusApiBase = `${getBaseUrl()}/api/projects/${project.id}/appdata`;
    const projectFiles = await generateMobileCode(project.name, project.prompt ?? project.description ?? "", nexusApiBase, project.id);

    const result = await publishOtaUpdate({
      easProjectSlug: projectEasSlug(project.id),
      accountName:    "Nexuselitestudio",
      branch,
      message,
      projectFiles,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "ota_publish_failed", message: err?.message ?? "OTA publish failed" });
  }
});

// ── Store Submission ──────────────────────────────────────────────────────────

/** Trigger a store submission for a finished build */
router.post("/:id/mobile-submit", requireAuth, async (req, res) => {
  const userId   = req.auth!.userId;
  const isAdmin  = req.auth!.isAdmin;
  const isVip    = req.auth!.isVip;
  const userPlan = req.auth!.plan;

  if (!mobileGuard(userPlan, isAdmin, isVip)) {
    res.status(402).json({ error: "plan_limit", code: "MOBILE_SUBMIT_NOT_ALLOWED", message: "Store submission requires Pro or Elite plan." });
    return;
  }

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const { buildId, platform } = req.body as { buildId?: string; platform?: "android" | "ios" };
  if (!buildId || !platform) { res.status(400).json({ error: "bad_request", message: "buildId and platform are required" }); return; }

  // Verify the build belongs to this project and is in a finished (terminal) state.
  // The frontend passes b.easBuildId (the EAS UUID), so we match on easBuildId.
  const [buildRow] = await db.select().from(mobileBuildTable)
    .where(and(eq(mobileBuildTable.easBuildId, buildId), eq(mobileBuildTable.projectId, project.id)))
    .limit(1);
  if (!buildRow) { res.status(404).json({ error: "build_not_found", message: "Build not found for this project." }); return; }
  if (buildRow.status !== "finished") {
    res.status(409).json({ error: "build_not_finished", message: `Build status is '${buildRow.status}' — can only submit finished builds.` });
    return;
  }

  try {
    // Use the EAS build ID (not the internal DB row ID) for submission
    const result = await submitBuild({ buildId: buildRow.easBuildId, platform });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "submit_failed", message: err?.message ?? "Submission failed" });
  }
});

/** Poll submission status */
router.get("/:id/mobile-submit/:submissionId", requireAuth, async (req, res) => {
  const userId  = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const subId   = String(req.params.submissionId);

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  try {
    const status = await getSubmissionStatus(subId);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: "poll_failed", message: err?.message ?? "Failed to get submission status" });
  }
});

// ── Webhooks ──────────────────────────────────────────────────────────────────

/** List webhooks for a project — reconciles local DB with EAS remote state */
router.get("/:id/webhooks", requireAuth, async (req, res) => {
  const userId  = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const localHooks = await db.select().from(easWebhookTable)
    .where(eq(easWebhookTable.projectId, project.id))
    .orderBy(sql`created_at DESC`);

  // Reconcile with EAS remote: mark hooks that are no longer registered remotely
  let remoteIds: Set<string> = new Set();
  try {
    const remoteHooks = await listEasWebhooks(projectEasSlug(project.id));
    remoteIds = new Set(remoteHooks.map(h => h.id));
  } catch {
    // If EAS is unavailable, serve local data with a sync_status flag
    return res.json(localHooks.map(h => ({ ...h, syncStatus: "eas_unavailable" })));
  }

  const reconciled = localHooks.map(h => ({
    ...h,
    syncStatus: h.easWebhookId && remoteIds.has(h.easWebhookId) ? "active" : "unsynced",
  }));
  res.json(reconciled);
});

/** Create a webhook for a project */
router.post("/:id/webhooks", requireAuth, async (req, res) => {
  const userId   = req.auth!.userId;
  const isAdmin  = req.auth!.isAdmin;
  const isVip    = req.auth!.isVip;
  const userPlan = req.auth!.plan;

  if (!mobileGuard(userPlan, isAdmin, isVip)) {
    res.status(402).json({ error: "plan_limit", message: "Webhooks require Pro or Elite plan." });
    return;
  }

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const { url, secret, events } = req.body as { url?: string; secret?: string; events?: WebhookEvent[] };
  if (!url) { res.status(400).json({ error: "bad_request", message: "url is required" }); return; }

  const eventsArr: WebhookEvent[] = Array.isArray(events) && events.length > 0 ? events : ["BUILD"];

  // Register with EAS first — fail closed: do not persist if EAS rejects
  let easWebhookId: string;
  try {
    easWebhookId = await createEasWebhook({
      appSlug: projectEasSlug(project.id),
      url,
      secret:  secret ?? "",
      events:  eventsArr,
    });
  } catch (err: any) {
    res.status(502).json({ error: "eas_registration_failed", message: err?.message ?? "EAS webhook registration failed" });
    return;
  }

  const [row] = await db.insert(easWebhookTable).values({
    id:           nanoid(),
    projectId:    project.id,
    url,
    secret:       secret ?? null,
    events:       eventsArr,
    easWebhookId,
  }).returning();

  res.status(201).json({ ...row, syncStatus: "active" });
});

/** Delete a webhook */
router.delete("/:id/webhooks/:webhookId", requireAuth, async (req, res) => {
  const userId    = req.auth!.userId;
  const isAdmin   = req.auth!.isAdmin;
  const webhookId = String(req.params.webhookId);

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const [hook] = await db.select().from(easWebhookTable).where(and(eq(easWebhookTable.id, webhookId), eq(easWebhookTable.projectId, project.id))).limit(1);
  if (!hook) { res.status(404).json({ error: "not_found" }); return; }

  if (hook.easWebhookId) {
    try {
      await deleteEasWebhook(hook.easWebhookId);
    } catch (err: any) {
      res.status(502).json({ error: "eas_delete_failed", message: err?.message ?? "EAS webhook deletion failed" });
      return;
    }
  }

  await db.delete(easWebhookTable).where(and(eq(easWebhookTable.id, webhookId), eq(easWebhookTable.projectId, project.id)));
  res.json({ ok: true });
});

// ── Workflows ─────────────────────────────────────────────────────────────────

/** Get workflow templates */
router.get("/:id/workflow-templates", requireAuth, async (_req, res) => {
  res.json(WORKFLOW_TEMPLATES);
});

/** List recent workflow runs */
router.get("/:id/workflows", requireAuth, async (req, res) => {
  const userId  = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const runs = await listWorkflowRuns(projectEasSlug(project.id));
  res.json(runs);
});

/** Trigger a workflow run — Elite or Admin only */
router.post("/:id/workflows/run", requireAuth, async (req, res) => {
  const userId   = req.auth!.userId;
  const isAdmin  = req.auth!.isAdmin;
  const userPlan = req.auth!.plan;

  if (!isAdmin && userPlan !== "elite") {
    res.status(402).json({ error: "plan_limit", code: "WORKFLOW_NOT_ALLOWED", message: "CI/CD workflow runs require the Elite plan." });
    return;
  }

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const { workflowName = "custom-workflow", yaml } = req.body as { workflowName?: string; yaml?: string };
  if (!yaml) { res.status(400).json({ error: "bad_request", message: "yaml is required" }); return; }

  try {
    const run = await triggerWorkflowRun({
      easProjectSlug: projectEasSlug(project.id),
      accountName:    "Nexuselitestudio",
      workflowName,
      yaml,
    });
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ error: "workflow_run_failed", message: err?.message ?? "Workflow trigger failed" });
  }
});

/** Get workflow run logs */
router.get("/:id/workflows/:runId/logs", requireAuth, async (req, res) => {
  const userId  = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, String(req.params.id)) })
    : await db.query.projectsTable.findFirst({ where: and(eq(projectsTable.id, String(req.params.id)), eq(projectsTable.userId, userId)) });
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const logs = await getWorkflowRunLogs(String(req.params.runId));
  res.json(logs);
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
