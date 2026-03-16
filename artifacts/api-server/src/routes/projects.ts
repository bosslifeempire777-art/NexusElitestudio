import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, buildLogsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "../lib/nanoid.js";
import { AGENT_REGISTRY } from "../lib/agents.js";

const router: IRouter = Router();

const PROJECT_TYPES = ["website", "mobile_app", "saas", "automation", "ai_tool", "game"];

function inferFramework(type: string, prompt: string): string {
  const p = prompt.toLowerCase();
  if (type === "game") {
    if (p.includes("unity")) return "Unity";
    if (p.includes("unreal")) return "Unreal Engine";
    return "Godot Engine";
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
      `[Game Engine Agent] 🕹️ Initializing Godot project...`,
      `[Asset Generator] 🖼️ Generating game assets...`,
      `[Level Builder] 🗺️ Building initial levels...`,
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

  setTimeout(async () => {
    try {
      await db.update(projectsTable)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(projectsTable.id, project.id));
    } catch {}
  }, 8000);

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
