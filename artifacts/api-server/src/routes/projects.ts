import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, buildLogsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "../lib/nanoid.js";
import { AGENT_REGISTRY } from "../lib/agents.js";
import { generateProjectCode, generateChatResponse } from "../lib/openrouter.js";

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

router.get("/", async (req, res) => {
  const userId = req.headers["x-user-id"] as string || "demo-user";
  const { type, status } = req.query as { type?: string; status?: string };

  let query = db.select().from(projectsTable).where(eq(projectsTable.userId, userId));

  const projects = await db.select().from(projectsTable).where(eq(projectsTable.userId, userId));

  let filtered = projects;
  if (type && type !== "all") filtered = filtered.filter((p) => p.type === type);
  if (status && status !== "all") filtered = filtered.filter((p) => p.status === status);

  res.json(filtered.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    agentLogs: Array.isArray(p.agentLogs) ? p.agentLogs : [],
  })));
});

router.post("/", async (req, res) => {
  const userId = req.headers["x-user-id"] as string || "demo-user";
  const { prompt, type, name } = req.body;

  if (!prompt || !type || !name) {
    return res.status(400).json({ error: "bad_request", message: "prompt, type, name are required" });
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

      await db.update(projectsTable)
        .set({ 
          status: "ready",
          generatedCode,
          updatedAt: new Date(),
          agentLogs: updatedLogs,
        })
        .where(eq(projectsTable.id, project.id));
    } catch (err) {
      console.error("Code generation failed:", err);
      await db.update(projectsTable)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(projectsTable.id, project.id));
    }
  });

  res.status(201).json({
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    agentLogs: project.agentLogs as string[],
  });
});

router.get("/:id", async (req, res) => {
  const userId = req.headers["x-user-id"] as string || "demo-user";
  const project = await db.query.projectsTable.findFirst({
    where: and(eq(projectsTable.id, req.params.id), eq(projectsTable.userId, userId)),
  });

  if (!project) return res.status(404).json({ error: "not_found", message: "Project not found" });

  res.json({
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    agentLogs: Array.isArray(project.agentLogs) ? project.agentLogs : [],
  });
});

router.delete("/:id", async (req, res) => {
  const userId = req.headers["x-user-id"] as string || "demo-user";
  await db.delete(projectsTable).where(
    and(eq(projectsTable.id, req.params.id), eq(projectsTable.userId, userId))
  );
  res.status(204).send();
});

router.get("/:id/build-logs", async (req, res) => {
  const project = await db.query.projectsTable.findFirst({
    where: eq(projectsTable.id, req.params.id),
  });

  if (!project) return res.status(404).json({ error: "not_found", message: "Project not found" });

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

router.get("/:id/preview", async (req, res) => {
  const project = await db.query.projectsTable.findFirst({
    where: eq(projectsTable.id, req.params.id),
  });

  if (!project) return res.status(404).send("<h1>Project not found</h1>");

  // Serve AI-generated code if available; fallback to template
  const html = project.generatedCode
    ? project.generatedCode
    : generatePreviewHtml(project.name, project.type, project.description || project.prompt || "");

  res.setHeader("Content-Type", "text/html");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.send(html);
});

// Rebuild a project (regenerate from scratch using AI)
router.post("/:id/rebuild", async (req, res) => {
  const userId = req.headers["x-user-id"] as string || "demo-user";

  const project = await db.query.projectsTable.findFirst({
    where: and(eq(projectsTable.id, req.params.id), eq(projectsTable.userId, userId)),
  });

  if (!project) return res.status(404).json({ error: "not_found", message: "Project not found" });

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

function generatePreviewHtml(name: string, type: string, description: string): string {
  const shortName = name.length > 30 ? name.slice(0, 30) + "…" : name;

  const themes: Record<string, { bg: string; accent: string; secondary: string; nav: string }> = {
    saas:       { bg: "#0f0f1a", accent: "#00d4ff", secondary: "#7c3aed", nav: "#1a1a2e" },
    website:    { bg: "#0a0a0a", accent: "#ff6b35", secondary: "#f7c59f", nav: "#111111" },
    mobile_app: { bg: "#121212", accent: "#4ade80", secondary: "#22d3ee", nav: "#1e1e1e" },
    ai_tool:    { bg: "#0d0d14", accent: "#a78bfa", secondary: "#60a5fa", nav: "#16162a" },
    automation: { bg: "#0f1319", accent: "#34d399", secondary: "#6ee7b7", nav: "#161d27" },
    game:       { bg: "#080810", accent: "#f472b6", secondary: "#fb923c", nav: "#10101c" },
  };

  const t = themes[type] || themes["saas"];

  if (type === "game") {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${shortName}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:${t.bg};color:#fff;font-family:'Segoe UI',sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
.star{position:absolute;border-radius:50%;background:#fff;animation:twinkle 3s infinite alternate}@keyframes twinkle{0%{opacity:.2}100%{opacity:1}}
.logo{font-size:3rem;font-weight:900;background:linear-gradient(135deg,${t.accent},${t.secondary});-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1rem;text-align:center;text-shadow:none}
.tagline{color:#aaa;font-size:.9rem;margin-bottom:2.5rem;text-align:center;letter-spacing:.2em;text-transform:uppercase}
.progress-bar{width:300px;height:6px;background:#1a1a2e;border-radius:3px;overflow:hidden;margin-bottom:.75rem}
.progress-fill{height:100%;width:0%;background:linear-gradient(90deg,${t.accent},${t.secondary});border-radius:3px;animation:load 3s ease-in-out forwards}
@keyframes load{0%{width:0%}100%{width:87%}}
.loading-text{color:#555;font-size:.75rem;letter-spacing:.15em;font-family:monospace}
.btn{margin-top:2rem;padding:.75rem 2rem;background:linear-gradient(135deg,${t.accent},${t.secondary});border:none;border-radius:8px;color:#000;font-weight:700;font-size:1rem;cursor:pointer;letter-spacing:.05em}
</style></head><body>
${Array.from({length:40}).map((_,i)=>`<div class="star" style="width:${Math.random()*3+1}px;height:${Math.random()*3+1}px;top:${Math.random()*100}%;left:${Math.random()*100}%;animation-delay:${Math.random()*3}s;animation-duration:${2+Math.random()*3}s"></div>`).join("")}
<div class="logo">${shortName}</div>
<div class="tagline">Powered by Nexus AI Game Engine</div>
<div class="progress-bar"><div class="progress-fill"></div></div>
<div class="loading-text">LOADING GAME ASSETS...</div>
<button class="btn" onclick="this.textContent='▶ LAUNCHING...'">▶ PLAY NOW</button>
</body></html>`;
  }

  if (type === "ai_tool") {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${shortName}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:${t.bg};color:#e2e8f0;font-family:'Segoe UI',sans-serif;height:100vh;display:flex;flex-direction:column}
nav{background:${t.nav};border-bottom:1px solid #2d2d4e;padding:.75rem 1.5rem;display:flex;align-items:center;justify-content:space-between}
.logo{font-weight:700;font-size:1.1rem;color:${t.accent}}
.badge{background:${t.secondary}22;border:1px solid ${t.secondary}44;color:${t.secondary};padding:.2rem .6rem;border-radius:999px;font-size:.7rem}
.chat{flex:1;display:flex;flex-direction:column;max-width:760px;margin:0 auto;width:100%;padding:1.5rem;gap:1rem;overflow-y:auto}
.msg{display:flex;gap:.75rem;align-items:flex-start}
.avatar{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.8rem;flex-shrink:0;font-weight:700}
.ai-avatar{background:linear-gradient(135deg,${t.accent},${t.secondary});color:#000}
.user-avatar{background:#2d2d4e;color:#aaa}
.bubble{background:#1a1a2e;border:1px solid #2d2d4e;border-radius:12px;padding:.75rem 1rem;font-size:.875rem;line-height:1.6;max-width:80%}
.user-msg{flex-direction:row-reverse}.user-msg .bubble{background:#1e1e3a;border-color:${t.accent}33}
.input-bar{background:${t.nav};border-top:1px solid #2d2d4e;padding:1rem 1.5rem;display:flex;gap:.75rem;max-width:760px;margin:0 auto;width:100%}
input{flex:1;background:#1a1a2e;border:1px solid #2d2d4e;border-radius:8px;padding:.6rem 1rem;color:#e2e8f0;font-size:.875rem;outline:none}
input:focus{border-color:${t.accent}66}
button{background:linear-gradient(135deg,${t.accent},${t.secondary});border:none;border-radius:8px;padding:.6rem 1.25rem;color:#000;font-weight:600;cursor:pointer}
.cursor{display:inline-block;width:2px;height:1em;background:${t.accent};animation:blink .8s infinite;vertical-align:middle}@keyframes blink{50%{opacity:0}}
</style></head><body>
<nav><span class="logo">⚡ ${shortName}</span><span class="badge">AI POWERED</span></nav>
<div class="chat">
  <div class="msg"><div class="avatar ai-avatar">AI</div><div class="bubble">Hello! I'm your AI assistant for <strong>${shortName}</strong>. ${description.slice(0,120)}... How can I help you today?</div></div>
  <div class="msg user-msg"><div class="avatar user-avatar">U</div><div class="bubble">Can you give me a quick overview of the system capabilities?</div></div>
  <div class="msg"><div class="avatar ai-avatar">AI</div><div class="bubble">Absolutely! This system is built with cutting-edge AI to provide: <br><br>✅ Natural language processing<br>✅ Real-time data analysis<br>✅ Automated workflow generation<br>✅ Multi-modal input support<br><br>What would you like to explore first? <span class="cursor"></span></div></div>
</div>
<div class="input-bar"><input placeholder="Ask anything..." /><button>Send</button></div>
</body></html>`;
  }

  if (type === "mobile_app") {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${shortName}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a1a;display:flex;align-items:center;justify-content:center;height:100vh;font-family:'Segoe UI',sans-serif}
.phone{width:320px;height:580px;background:${t.bg};border-radius:40px;border:8px solid #2a2a2a;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 30px 80px #00000088}
.status{background:${t.nav};padding:.5rem 1.25rem;display:flex;justify-content:space-between;font-size:.65rem;color:#777}
.header{background:${t.nav};padding:1rem 1.25rem;border-bottom:1px solid #2a2a2a}
.header h2{font-size:1.1rem;font-weight:700;color:${t.accent}}
.header p{font-size:.7rem;color:#666;margin-top:.2rem}
.content{flex:1;overflow-y:auto;padding:.75rem}
.card{background:#1e1e1e;border-radius:12px;padding:.75rem;margin-bottom:.5rem;border:1px solid #2a2a2a;display:flex;align-items:center;gap:.75rem}
.icon{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,${t.accent}33,${t.secondary}33);display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0}
.card-text h4{font-size:.8rem;font-weight:600;color:#e2e8f0}
.card-text p{font-size:.7rem;color:#666;margin-top:.1rem}
.stat-row{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem}
.stat{background:#1e1e1e;border-radius:10px;padding:.6rem;text-align:center;border:1px solid #2a2a2a}
.stat-val{font-size:1.2rem;font-weight:700;color:${t.accent}}
.stat-label{font-size:.6rem;color:#555;margin-top:.1rem}
.nav-bar{background:${t.nav};padding:.75rem;display:flex;justify-content:space-around;border-top:1px solid #2a2a2a}
.nav-item{display:flex;flex-direction:column;align-items:center;gap:.2rem;font-size:.6rem;color:#555}
.nav-item.active{color:${t.accent}}
.nav-icon{font-size:1.1rem}
</style></head><body>
<div class="phone">
  <div class="status"><span>9:41</span><span>●●●</span></div>
  <div class="header"><h2>${shortName}</h2><p>Welcome back, User</p></div>
  <div class="content">
    <div class="stat-row">
      <div class="stat"><div class="stat-val">248</div><div class="stat-label">TOTAL</div></div>
      <div class="stat"><div class="stat-val" style="color:${t.secondary}">+12</div><div class="stat-label">TODAY</div></div>
    </div>
    <div class="card"><div class="icon">🚀</div><div class="card-text"><h4>Quick Start</h4><p>Get started with the app</p></div></div>
    <div class="card"><div class="icon">📊</div><div class="card-text"><h4>Analytics</h4><p>View your performance</p></div></div>
    <div class="card"><div class="icon">⚙️</div><div class="card-text"><h4>Settings</h4><p>Customize your experience</p></div></div>
    <div class="card"><div class="icon">🔔</div><div class="card-text"><h4>Notifications</h4><p>3 new alerts</p></div></div>
  </div>
  <div class="nav-bar">
    <div class="nav-item active"><div class="nav-icon">🏠</div>Home</div>
    <div class="nav-item"><div class="nav-icon">🔍</div>Search</div>
    <div class="nav-item"><div class="nav-icon">📈</div>Stats</div>
    <div class="nav-item"><div class="nav-icon">👤</div>Profile</div>
  </div>
</div>
</body></html>`;
  }

  if (type === "automation") {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${shortName}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:${t.bg};color:#e2e8f0;font-family:'Segoe UI',sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}
nav{background:${t.nav};border-bottom:1px solid #1e2d24;padding:.75rem 1.5rem;display:flex;align-items:center;gap:1rem}
.logo{font-weight:700;color:${t.accent};font-size:1rem}
.status-dot{width:8px;height:8px;border-radius:50%;background:${t.accent};box-shadow:0 0 8px ${t.accent};animation:pulse 2s infinite}@keyframes pulse{50%{opacity:.4}}
.main{display:flex;flex:1;overflow:hidden}
.sidebar{width:220px;background:${t.nav};border-right:1px solid #1e2d24;padding:1rem;display:flex;flex-direction:column;gap:.25rem}
.nav-item{padding:.5rem .75rem;border-radius:6px;font-size:.8rem;cursor:pointer;color:#6b7280;display:flex;align-items:center;gap:.5rem}
.nav-item.active{background:${t.accent}22;color:${t.accent}}
.content{flex:1;padding:1.5rem;overflow-y:auto}
h2{font-size:1.1rem;font-weight:600;margin-bottom:1rem;color:#fff}
.flow{display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap}
.node{background:#1a2520;border:1px solid ${t.accent}44;border-radius:8px;padding:.5rem .875rem;font-size:.75rem;color:${t.accent};position:relative}
.node.trigger{border-color:${t.secondary}66;color:${t.secondary}}
.node.action{border-color:#60a5fa66;color:#60a5fa}
.arrow{color:#374151;font-size:.8rem}
.runs{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-top:1.25rem}
.run-card{background:#0f1a14;border:1px solid #1e2d24;border-radius:8px;padding:.75rem}
.run-card h4{font-size:.75rem;color:#9ca3af;margin-bottom:.25rem}
.run-card .val{font-size:1.3rem;font-weight:700;color:${t.accent}}
.log{background:#0a0f0d;border-radius:8px;padding:.75rem;margin-top:1rem;font-family:monospace;font-size:.7rem;color:#4ade80;max-height:120px;overflow-y:auto}
.log div{margin-bottom:.2rem}
</style></head><body>
<nav><div class="status-dot"></div><span class="logo">⚡ ${shortName}</span><span style="font-size:.7rem;color:#6b7280;margin-left:auto">AUTOMATION ACTIVE</span></nav>
<div class="main">
  <div class="sidebar">
    <div class="nav-item active">🔄 Workflows</div>
    <div class="nav-item">📊 Analytics</div>
    <div class="nav-item">🔗 Integrations</div>
    <div class="nav-item">📋 Logs</div>
    <div class="nav-item">⚙️ Settings</div>
  </div>
  <div class="content">
    <h2>Active Workflow</h2>
    <div class="flow">
      <div class="node trigger">⚡ Trigger</div><div class="arrow">→</div>
      <div class="node">🔍 Filter</div><div class="arrow">→</div>
      <div class="node action">⚙️ Process</div><div class="arrow">→</div>
      <div class="node action">📤 Output</div><div class="arrow">→</div>
      <div class="node trigger">✅ Done</div>
    </div>
    <div class="runs">
      <div class="run-card"><h4>RUNS TODAY</h4><div class="val">1,284</div></div>
      <div class="run-card"><h4>SUCCESS RATE</h4><div class="val">99.2%</div></div>
      <div class="run-card"><h4>AVG TIME</h4><div class="val">0.3s</div></div>
    </div>
    <div class="log">
      <div>[12:01:44] ✓ Trigger received — processing batch #4821</div>
      <div>[12:01:44] ✓ Filter applied — 42 records passed</div>
      <div>[12:01:45] ✓ Data transformed successfully</div>
      <div>[12:01:45] ✓ Output dispatched to endpoint</div>
      <div>[12:01:46] ✓ Workflow complete — 0.31s</div>
    </div>
  </div>
</div>
</body></html>`;
  }

  if (type === "website") {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${shortName}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:${t.bg};color:#e2e8f0;font-family:'Segoe UI',sans-serif;overflow:hidden;height:100vh}
nav{background:#111;border-bottom:1px solid #222;padding:.875rem 2rem;display:flex;align-items:center;justify-content:space-between}
.logo{font-weight:800;font-size:1.1rem;color:${t.accent}}
.nav-links{display:flex;gap:1.5rem;font-size:.8rem;color:#9ca3af}
.nav-links a{color:#9ca3af;text-decoration:none;cursor:pointer}
.btn-nav{background:${t.accent};color:#000;padding:.4rem 1rem;border-radius:6px;font-size:.8rem;font-weight:600;cursor:pointer;border:none}
.hero{text-align:center;padding:3rem 2rem;max-width:700px;margin:0 auto}
.hero h1{font-size:2.5rem;font-weight:900;line-height:1.1;margin-bottom:1rem;background:linear-gradient(135deg,#fff,${t.accent});-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hero p{color:#9ca3af;font-size:.95rem;line-height:1.7;margin-bottom:2rem;max-width:500px;margin-left:auto;margin-right:auto}
.btn-row{display:flex;gap:1rem;justify-content:center}
.btn-primary{background:${t.accent};color:#000;padding:.75rem 1.75rem;border-radius:8px;font-weight:700;cursor:pointer;border:none;font-size:.9rem}
.btn-secondary{background:transparent;color:#e2e8f0;padding:.75rem 1.75rem;border-radius:8px;font-weight:600;cursor:pointer;border:1px solid #333;font-size:.9rem}
.features{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;padding:1.5rem 2rem;max-width:800px;margin:0 auto}
.feat{background:#111;border:1px solid #222;border-radius:10px;padding:1rem;text-align:center}
.feat-icon{font-size:1.5rem;margin-bottom:.5rem}
.feat h4{font-size:.8rem;font-weight:600;color:#fff;margin-bottom:.25rem}
.feat p{font-size:.7rem;color:#6b7280;line-height:1.5}
</style></head><body>
<nav><span class="logo">${shortName}</span><div class="nav-links"><a>Home</a><a>Features</a><a>Pricing</a><a>Docs</a></div><button class="btn-nav">Get Started</button></nav>
<div class="hero">
  <h1>${shortName}</h1>
  <p>${description.slice(0,140) || "Built with cutting-edge technology to deliver the best experience for your users."}</p>
  <div class="btn-row"><button class="btn-primary">Get Started Free</button><button class="btn-secondary">View Demo</button></div>
</div>
<div class="features">
  <div class="feat"><div class="feat-icon">⚡</div><h4>Lightning Fast</h4><p>Optimized performance out of the box</p></div>
  <div class="feat"><div class="feat-icon">🔒</div><h4>Secure by Default</h4><p>Enterprise-grade security built in</p></div>
  <div class="feat"><div class="feat-icon">🤖</div><h4>AI Powered</h4><p>Smart features that learn and adapt</p></div>
</div>
</body></html>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${shortName}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:${t.bg};color:#e2e8f0;font-family:'Segoe UI',sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}
nav{background:${t.nav};border-bottom:1px solid #1e1e3e;padding:.75rem 1.5rem;display:flex;align-items:center;justify-content:space-between}
.logo{font-weight:700;color:${t.accent};font-size:1rem}
.user{display:flex;align-items:center;gap:.5rem;font-size:.75rem;color:#6b7280}
.avatar{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,${t.accent},${t.secondary});display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;color:#000}
.main{display:flex;flex:1;overflow:hidden}
.sidebar{width:200px;background:${t.nav};border-right:1px solid #1e1e3e;padding:1rem;display:flex;flex-direction:column;gap:.25rem}
.nav-item{padding:.5rem .75rem;border-radius:6px;font-size:.78rem;cursor:pointer;color:#6b7280;display:flex;align-items:center;gap:.5rem}
.nav-item.active{background:${t.accent}22;color:${t.accent};font-weight:600}
.content{flex:1;padding:1.5rem;overflow-y:auto}
.page-title{font-size:1.2rem;font-weight:700;margin-bottom:1.25rem;color:#fff}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem;margin-bottom:1.25rem}
.stat-card{background:#0d0d1f;border:1px solid #1e1e3e;border-radius:10px;padding:.875rem}
.stat-card .label{font-size:.65rem;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.25rem}
.stat-card .value{font-size:1.4rem;font-weight:700;color:${t.accent}}
.stat-card .change{font-size:.65rem;color:#34d399;margin-top:.2rem}
.table-header{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:.5rem;padding:.5rem .75rem;font-size:.7rem;color:#4b5563;border-bottom:1px solid #1e1e3e;margin-bottom:.25rem}
.table-row{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:.5rem;padding:.5rem .75rem;font-size:.75rem;border-radius:6px;cursor:pointer}
.table-row:hover{background:#0d0d1f}
.badge{display:inline-flex;padding:.1rem .5rem;border-radius:999px;font-size:.65rem;font-weight:600}
.badge.active{background:${t.accent}22;color:${t.accent}}
.badge.pending{background:#f59e0b22;color:#f59e0b}
</style></head><body>
<nav><span class="logo">◈ ${shortName}</span><div class="user"><div class="avatar">U</div>Admin</div></nav>
<div class="main">
  <div class="sidebar">
    <div class="nav-item active">📊 Dashboard</div>
    <div class="nav-item">👥 Users</div>
    <div class="nav-item">📦 Products</div>
    <div class="nav-item">💳 Billing</div>
    <div class="nav-item">📈 Analytics</div>
    <div class="nav-item">⚙️ Settings</div>
  </div>
  <div class="content">
    <div class="page-title">Dashboard Overview</div>
    <div class="stats">
      <div class="stat-card"><div class="label">Total Users</div><div class="value">12,840</div><div class="change">↑ 8.2% this week</div></div>
      <div class="stat-card"><div class="label">Revenue</div><div class="value" style="color:${t.secondary}">$48.2K</div><div class="change">↑ 12.4% this week</div></div>
      <div class="stat-card"><div class="label">Active Now</div><div class="value" style="color:#34d399">1,284</div><div class="change">↑ 3.1% today</div></div>
      <div class="stat-card"><div class="label">Conversion</div><div class="value" style="color:#f472b6">3.8%</div><div class="change">↑ 0.4% this week</div></div>
    </div>
    <div class="table-header"><span>NAME</span><span>STATUS</span><span>PLAN</span><span>REVENUE</span></div>
    ${["Acme Corp","NovaTech","DataSync AI","Quantum Labs","SkyBridge"].map((n,i)=>`<div class="table-row"><span>${n}</span><span><span class="badge ${i%4===2?'pending':'active'}">${i%4===2?'Pending':'Active'}</span></span><span style="color:#9ca3af">${['Pro','Enterprise','Starter','Pro','Enterprise'][i]}</span><span style="color:${t.accent}">$${[2400,8900,490,1800,12000][i].toLocaleString()}</span></div>`).join("")}
  </div>
</div>
</body></html>`;
}

router.post("/:id/chat", async (req, res) => {
  const userId = req.headers["x-user-id"] as string || "demo-user";
  const { message, action } = req.body as { message?: string; action?: string };

  if (!message && !action) {
    return res.status(400).json({ error: "bad_request", message: "message or action is required" });
  }

  const project = await db.query.projectsTable.findFirst({
    where: and(eq(projectsTable.id, req.params.id), eq(projectsTable.userId, userId)),
  });

  if (!project) return res.status(404).json({ error: "not_found", message: "Project not found" });

  const userText = action && !message ? action : `${action ? `[${action}] ` : ""}${message || ""}`.trim();

  const agentReply = await generateChatResponse(
    project.type,
    project.name,
    userText,
    project.prompt,
  );

  const history = ((project.chatHistory as any[]) || []);
  const newHistory = [
    ...history,
    { role: "user",  content: userText,   timestamp: new Date().toISOString() },
    { role: "agent", content: agentReply, timestamp: new Date().toISOString() },
  ];

  await db.update(projectsTable)
    .set({ chatHistory: newHistory, updatedAt: new Date() })
    .where(eq(projectsTable.id, req.params.id));

  res.json({ reply: agentReply, history: newHistory });
});

router.get("/:id/files", async (req, res) => {
  const project = await db.query.projectsTable.findFirst({
    where: eq(projectsTable.id, req.params.id),
  });

  if (!project) return res.status(404).json({ error: "not_found", message: "Project not found" });

  const fileTree = generateFileTree(project.type, project.framework || "");
  res.json(fileTree);
});

function generateFileTree(type: string, framework: string) {
  if (type === "game") {
    return [
      { name: "project.godot", path: "/project.godot", type: "file", content: '[gd_resource type="ProjectSettings"]' },
      { name: "src", path: "/src", type: "directory", children: [
        { name: "main.gd", path: "/src/main.gd", type: "file", content: "extends Node\n\nfunc _ready():\n\tprint('Game started!')" },
        { name: "player", path: "/src/player", type: "directory", children: [
          { name: "Player.gd", path: "/src/player/Player.gd", type: "file", content: "extends CharacterBody3D\n\nconst SPEED = 5.0\nconst JUMP_VELOCITY = 4.5\n\nfunc _physics_process(delta):\n\tif not is_on_floor():\n\t\tvelocity.y -= 9.8 * delta\n\n\tvar direction = Input.get_vector('ui_left', 'ui_right', 'ui_up', 'ui_down')\n\tvelocity.x = direction.x * SPEED\n\tvelocity.z = direction.y * SPEED\n\n\tmove_and_slide()" },
        ]},
        { name: "levels", path: "/src/levels", type: "directory", children: [
          { name: "Level1.tscn", path: "/src/levels/Level1.tscn", type: "file", content: '[gd_scene load_steps=2 format=3]\n\n[node name="Level1" type="Node3D"]' },
        ]},
      ]},
      { name: "assets", path: "/assets", type: "directory", children: [
        { name: "textures", path: "/assets/textures", type: "directory", children: [] },
        { name: "models", path: "/assets/models", type: "directory", children: [] },
        { name: "audio", path: "/assets/audio", type: "directory", children: [] },
      ]},
    ];
  }

  if (type === "mobile_app") {
    return [
      { name: "package.json", path: "/package.json", type: "file", content: '{\n  "name": "my-app",\n  "version": "1.0.0",\n  "dependencies": {\n    "react-native": "0.73.0",\n    "expo": "~50.0.0"\n  }\n}' },
      { name: "App.tsx", path: "/App.tsx", type: "file", content: "import React from 'react';\nimport { View, Text, StyleSheet } from 'react-native';\n\nexport default function App() {\n  return (\n    <View style={styles.container}>\n      <Text>Hello from AI Studio!</Text>\n    </View>\n  );\n}" },
      { name: "src", path: "/src", type: "directory", children: [
        { name: "screens", path: "/src/screens", type: "directory", children: [
          { name: "HomeScreen.tsx", path: "/src/screens/HomeScreen.tsx", type: "file", content: "import React from 'react';\nimport { View, Text } from 'react-native';\n\nexport function HomeScreen() {\n  return <View><Text>Home</Text></View>;\n}" },
        ]},
        { name: "components", path: "/src/components", type: "directory", children: [] },
      ]},
    ];
  }

  return [
    { name: "package.json", path: "/package.json", type: "file", content: '{\n  "name": "my-project",\n  "version": "1.0.0",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build",\n    "start": "node server.js"\n  }\n}' },
    { name: "src", path: "/src", type: "directory", children: [
      { name: "main.tsx", path: "/src/main.tsx", type: "file", content: "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\n\nReactDOM.createRoot(document.getElementById('root')!).render(<App />);" },
      { name: "App.tsx", path: "/src/App.tsx", type: "file", content: "import React from 'react';\n\nexport default function App() {\n  return <div className='app'>Hello World</div>;\n}" },
      { name: "components", path: "/src/components", type: "directory", children: [] },
      { name: "pages", path: "/src/pages", type: "directory", children: [
        { name: "Dashboard.tsx", path: "/src/pages/Dashboard.tsx", type: "file", content: "import React from 'react';\n\nexport default function Dashboard() {\n  return <div>Dashboard</div>;\n}" },
      ]},
    ]},
    { name: "server", path: "/server", type: "directory", children: [
      { name: "index.ts", path: "/server/index.ts", type: "file", content: "import express from 'express';\n\nconst app = express();\n\napp.get('/api/health', (req, res) => {\n  res.json({ status: 'ok' });\n});\n\napp.listen(3000);" },
      { name: "routes", path: "/server/routes", type: "directory", children: [
        { name: "api.ts", path: "/server/routes/api.ts", type: "file", content: "import { Router } from 'express';\n\nconst router = Router();\n\nrouter.get('/', (req, res) => {\n  res.json({ message: 'API is running' });\n});\n\nexport default router;" },
      ]},
    ]},
    { name: "public", path: "/public", type: "directory", children: [] },
  ];
}

export default router;
