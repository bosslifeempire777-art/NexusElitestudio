/**
 * artifacts/api-server/src/routes/agents.ts
 *
 * HYDRA-PRIME agent registry + real OpenRouter execution.
 *
 * GET  /api/agents           → list all HYDRA agents (7 layers)
 * POST /api/agents/:id/run   → parallel multi-tier execution, orchestrator picks best
 * POST /api/agents/hydra/build → full HYDRA-PRIME build, streams logs via SSE
 */

import { Router, type IRouter } from "express";
import { chatViaSdk } from "../lib/openrouterSdk.js";
import { buildProject, MODEL_TIERS } from "../lib/hydraSwarm.js";

const router: IRouter = Router();

// ============================================================
// HYDRA-PRIME AGENT REGISTRY
// 7 layers, 24 agents — matches SwarmTerminal.tsx SWARM_AGENTS
// ============================================================

export const HYDRA_REGISTRY = [
  // ── Layer 1 — SOVEREIGN ────────────────────────────────────
  {
    id: "sovereign",
    name: "SOVEREIGN",
    layer: 1,
    description:
      "CEO Brain — classifies project type, outputs master blueprint",
    category: "orchestration",
    icon: "👑",
    color: "violet",
    status: "idle",
    capabilities: [
      "project classification",
      "blueprint generation",
      "risk analysis",
      "stack selection",
    ],
  },
  // ── Layer 2 — ARCHITECT COUNCIL ────────────────────────────
  {
    id: "sys-architect",
    name: "System Architect",
    layer: 2,
    description: "Designs modules, services, and data flow",
    category: "architecture",
    icon: "🏗️",
    color: "blue",
    status: "idle",
    capabilities: [
      "module design",
      "microservices",
      "API contracts",
      "data flow",
    ],
  },
  {
    id: "ux-architect",
    name: "UX Architect",
    layer: 2,
    description: "Designs screens, flows, components, and design system",
    category: "architecture",
    icon: "🎨",
    color: "pink",
    status: "idle",
    capabilities: [
      "screen design",
      "user flows",
      "component library",
      "design tokens",
    ],
  },
  {
    id: "data-architect",
    name: "Data Architect",
    layer: 2,
    description: "Designs schemas, indexes, migrations, and data APIs",
    category: "architecture",
    icon: "🗄️",
    color: "cyan",
    status: "idle",
    capabilities: ["schema design", "indexing", "migrations", "data APIs"],
  },
  {
    id: "security-architect",
    name: "Security Architect",
    layer: 2,
    description: "Designs auth, RBAC, secrets management, and threat model",
    category: "architecture",
    icon: "🔐",
    color: "red",
    status: "idle",
    capabilities: ["auth design", "RBAC", "secrets", "threat modeling"],
  },
  {
    id: "devops-architect",
    name: "DevOps Architect",
    layer: 2,
    description: "Designs CI/CD pipelines, infra, deployments, and monitoring",
    category: "architecture",
    icon: "⚙️",
    color: "gray",
    status: "idle",
    capabilities: ["CI/CD", "infrastructure", "deploy pipelines", "monitoring"],
  },
  // ── Layer 3 — DEPARTMENT HEADS ─────────────────────────────
  {
    id: "frontend-head",
    name: "Frontend Head",
    layer: 3,
    description: "React, Next.js, Vue, Svelte web UIs",
    category: "department",
    icon: "💻",
    color: "green",
    status: "idle",
    capabilities: ["React", "Next.js", "Vue", "Svelte", "Tailwind CSS"],
  },
  {
    id: "backend-head",
    name: "Backend Head",
    layer: 3,
    description: "Node/Python/Go APIs and microservices",
    category: "department",
    icon: "🔧",
    color: "orange",
    status: "idle",
    capabilities: ["Node.js", "Python", "Go", "REST", "GraphQL"],
  },
  {
    id: "database-head",
    name: "Database Head",
    layer: 3,
    description: "Postgres, MongoDB, Redis — schemas, queries, ORM",
    category: "department",
    icon: "🗃️",
    color: "yellow",
    status: "idle",
    capabilities: ["PostgreSQL", "MongoDB", "Redis", "Drizzle ORM", "Prisma"],
  },
  {
    id: "mobile-head",
    name: "Mobile Head",
    layer: 3,
    description: "iOS (Swift) and Android (Kotlin) or React Native",
    category: "department",
    icon: "📱",
    color: "blue",
    status: "idle",
    capabilities: [
      "Swift/SwiftUI",
      "Kotlin/Jetpack",
      "React Native",
      "Expo",
      "EAS",
    ],
  },
  {
    id: "gameengine-head",
    name: "GameEngine Head",
    layer: 3,
    description: "Unity C#, Godot, Phaser, Three.js game development",
    category: "department",
    icon: "🎮",
    color: "purple",
    status: "idle",
    capabilities: ["Unity", "Godot", "Phaser", "Three.js", "Canvas API"],
  },
  {
    id: "aiml-head",
    name: "AI/ML Head",
    layer: 3,
    description: "LLM integration, embeddings, RAG pipelines",
    category: "department",
    icon: "🤖",
    color: "indigo",
    status: "idle",
    capabilities: [
      "LLM APIs",
      "embeddings",
      "RAG",
      "vector search",
      "OpenRouter",
    ],
  },
  {
    id: "auth-head",
    name: "Auth Head",
    layer: 3,
    description: "OAuth, JWT, sessions, RBAC",
    category: "department",
    icon: "🔑",
    color: "amber",
    status: "idle",
    capabilities: ["OAuth2", "JWT", "sessions", "RBAC", "2FA"],
  },
  {
    id: "payments-head",
    name: "Payments Head",
    layer: 3,
    description: "Stripe, in-app purchases, subscription billing",
    category: "department",
    icon: "💳",
    color: "green",
    status: "idle",
    capabilities: [
      "Stripe",
      "IAP",
      "subscriptions",
      "webhooks",
      "billing portals",
    ],
  },
  {
    id: "devops-head",
    name: "DevOps Head",
    layer: 3,
    description: "Docker, CI pipelines, deploy scripts, EAS",
    category: "department",
    icon: "🚀",
    color: "gray",
    status: "idle",
    capabilities: ["Docker", "GitHub Actions", "Render", "EAS", "Nginx"],
  },
  {
    id: "qa-head",
    name: "QA Head",
    layer: 3,
    description: "Unit, integration, and e2e testing",
    category: "department",
    icon: "🧪",
    color: "teal",
    status: "idle",
    capabilities: [
      "Jest",
      "Vitest",
      "Playwright",
      "Cypress",
      "testing-library",
    ],
  },
  {
    id: "docs-head",
    name: "Docs Head",
    layer: 3,
    description: "README, API docs, user guides, changelogs",
    category: "department",
    icon: "📚",
    color: "sky",
    status: "idle",
    capabilities: ["README", "OpenAPI", "JSDoc", "Storybook", "changelogs"],
  },
  // ── Layer 4 — FRACTAL WORKERS ──────────────────────────────
  {
    id: "worker-pod",
    name: "Worker Pods",
    layer: 4,
    description:
      "3–10 cheap fast workers executing atomic tasks per department pod",
    category: "workers",
    icon: "⚡",
    color: "yellow",
    status: "idle",
    capabilities: [
      "parallel execution",
      "code generation",
      "file writing",
      "task execution",
    ],
  },
  {
    id: "fractal-sub",
    name: "Fractal Sub-swarm",
    layer: 4,
    description: "Recursively spawns micro-task sub-swarms up to depth 4",
    category: "workers",
    icon: "🔀",
    color: "cyan",
    status: "idle",
    capabilities: [
      "task splitting",
      "recursive spawning",
      "fractal execution",
      "sub-swarming",
    ],
  },
  // ── Layer 5 — CRITIC RING ──────────────────────────────────
  {
    id: "bug-hunter",
    name: "Bug Hunter",
    layer: 5,
    description: "Adversarial review — hunts bugs, edge cases, runtime errors",
    category: "critic",
    icon: "🐛",
    color: "red",
    status: "idle",
    capabilities: [
      "bug detection",
      "edge case analysis",
      "runtime errors",
      "code review",
    ],
  },
  {
    id: "sec-auditor",
    name: "Security Auditor",
    layer: 5,
    description:
      "Adversarial review — hunts injection, XSS, auth flaws, secret leaks",
    category: "critic",
    icon: "🛡️",
    color: "red",
    status: "idle",
    capabilities: [
      "SQL injection",
      "XSS",
      "CSRF",
      "auth flaws",
      "secret scanning",
    ],
  },
  {
    id: "ux-critic",
    name: "UX Critic",
    layer: 5,
    description: "Adversarial review — hunts UX and accessibility issues",
    category: "critic",
    icon: "👁️",
    color: "pink",
    status: "idle",
    capabilities: ["UX review", "a11y", "WCAG", "usability", "flow analysis"],
  },
  // ── Layer 6 — SYNTHESIZER ──────────────────────────────────
  {
    id: "synthesizer",
    name: "Synthesizer",
    layer: 6,
    description:
      "Merges all artifacts, resolves conflicts, writes final file tree",
    category: "synthesis",
    icon: "🧬",
    color: "violet",
    status: "idle",
    capabilities: [
      "conflict resolution",
      "file merging",
      "import resolution",
      "coherence check",
    ],
  },
  // ── Layer 7 — VALIDATOR ────────────────────────────────────
  {
    id: "validator",
    name: "Validator",
    layer: 7,
    description: "Static analysis, packaging, README, Dockerfile, .env.example",
    category: "validation",
    icon: "✅",
    color: "green",
    status: "idle",
    capabilities: [
      "static analysis",
      "packaging",
      "metadata generation",
      "Dockerfile",
      "deploy config",
    ],
  },
];

// ============================================================
// GET /api/agents — list all HYDRA agents
// ============================================================

router.get("/", (_req, res) => {
  const agents = HYDRA_REGISTRY.map((agent) => ({
    ...agent,
    status: Math.random() > 0.85 ? "running" : "idle",
  }));
  res.json(agents);
});

// ============================================================
// POST /api/agents/hydra/build
// Full HYDRA-PRIME 7-layer build — streams logs via SSE
// Must be registered BEFORE /:id/run to avoid route collision
// ============================================================

router.post("/hydra/build", async (req, res) => {
  const { prompt } = req.body as { prompt?: string };

  if (!prompt?.trim()) {
    res
      .status(400)
      .json({ error: "bad_request", message: "prompt is required" });
    return;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    res
      .status(503)
      .json({ error: "no_api_key", message: "OPENROUTER_API_KEY not set" });
    return;
  }

  // Set up SSE stream so the frontend receives live log lines
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (msg: string) => {
    res.write(`data: ${JSON.stringify({ msg })}\n\n`);
  };

  try {
    const result = await buildProject(prompt.trim(), send);
    // Final payload contains all generated files + metrics
    res.write(`data: ${JSON.stringify({ type: "complete", result })}\n\n`);
    res.write(`data: ${JSON.stringify({ msg: "__DONE__" })}\n\n`);
  } catch (err: any) {
    send(`❌ HYDRA build failed: ${err?.message ?? String(err)}`);
    res.write(`data: ${JSON.stringify({ msg: "__DONE__" })}\n\n`);
  } finally {
    res.end();
  }
});

// ============================================================
// POST /api/agents/:id/run
//
// Parallel multi-tier execution:
//   1. Fire the task through Tier-0, Tier-1, and Tier-2 models SIMULTANEOUSLY
//   2. Collect all successful results
//   3. SOVEREIGN (orchestrator) evaluates and returns the single best result
// ============================================================

router.post("/:id/run", async (req, res) => {
  const agent = HYDRA_REGISTRY.find((a) => a.id === req.params.id);

  if (!agent) {
    res.status(404).json({ error: "not_found", message: "Agent not found" });
    return;
  }

  const { task, context = "" } = req.body as {
    task?: string;
    context?: string;
  };
  if (!task?.trim()) {
    res.status(400).json({ error: "bad_request", message: "task is required" });
    return;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    res
      .status(503)
      .json({ error: "no_api_key", message: "OPENROUTER_API_KEY not set" });
    return;
  }

  const startTime = Date.now();

  // Choose the right model tier for this agent's layer
  const tier =
    agent.layer <= 2
      ? "reasoning"
      : agent.layer === 5
        ? "critic"
        : agent.layer === 6
          ? "longctx"
          : "coding";

  const tierModels = MODEL_TIERS[tier] ?? MODEL_TIERS.coding;

  // Split tier into three parallel "sub-chains": cheap → mid → premium
  const tier0 = tierModels.slice(0, 2); // fastest / cheapest
  const tier1 = tierModels.slice(2, 4); // mid-range
  const tier2 = tierModels.slice(4, 6); // premium fallback

  const systemPrompt =
    `You are ${agent.name}, a ${agent.description}. ` +
    "Respond with production-quality, fully implemented output. " +
    "No placeholders. No TODOs. Complete implementations only.";

  const userPrompt = context
    ? `CONTEXT:\n${context}\n\nTASK:\n${task.trim()}`
    : task.trim();

  // ── Run one sub-chain; return first success ────────────────
  async function runSubChain(
    models: string[],
  ): Promise<{ model: string; output: string } | null> {
    for (const model of models) {
      try {
        const data = await chatViaSdk(
          {
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 4000,
            temperature: 0.3,
          },
          { timeoutMs: 60_000 },
        );
        const output = data.choices?.[0]?.message?.content ?? "";
        if (output) return { model, output };
      } catch {
        continue;
      }
    }
    return null;
  }

  try {
    // Fire all three tiers in parallel
    const [r0, r1, r2] = await Promise.all([
      runSubChain(tier0),
      runSubChain(tier1),
      runSubChain(tier2),
    ]);

    const candidates = [r0, r1, r2].filter(Boolean) as Array<{
      model: string;
      output: string;
    }>;

    if (!candidates.length) {
      res.status(503).json({
        error: "all_models_failed",
        message: "All model tiers failed for this task",
      });
      return;
    }

    // ── If only one candidate, return it immediately ─────────
    if (candidates.length === 1) {
      res.json({
        success: true,
        output: candidates[0].output,
        agentId: agent.id,
        agentName: agent.name,
        model: candidates[0].model,
        candidatesCount: 1,
        orchestrated: false,
        duration: Date.now() - startTime,
      });
      return;
    }

    // ── Multiple candidates: SOVEREIGN picks the best ─────────
    const orchestratorPrompt = [
      `You are SOVEREIGN, the master orchestrator for HYDRA-PRIME SWARM.`,
      `You received ${candidates.length} responses to the same task from different model tiers.`,
      "",
      `ORIGINAL TASK:\n${task.trim()}`,
      "",
      ...candidates.map(
        (c, i) => `=== CANDIDATE ${i + 1} (${c.model}) ===\n${c.output}`,
      ),
      "",
      "Evaluate each candidate on: correctness, completeness, code quality, and production-readiness.",
      "Return ONLY the single best response verbatim. No explanation, no preamble, no labels.",
      "Just output the best response content exactly as-is.",
    ].join("\n");

    let bestOutput = candidates[0].output;
    let bestModel = candidates[0].model;
    let orchestrated = false;

    for (const model of MODEL_TIERS.reasoning.slice(0, 3)) {
      try {
        const data = await chatViaSdk(
          {
            model,
            messages: [{ role: "user", content: orchestratorPrompt }],
            max_tokens: 4000,
            temperature: 0.1, // low temp for consistent judge behaviour
          },
          { timeoutMs: 60_000 },
        );
        const picked = data.choices?.[0]?.message?.content ?? "";
        if (picked) {
          bestOutput = picked;
          bestModel = `orchestrated-by:${model}`;
          orchestrated = true;
          break;
        }
      } catch {
        continue;
      }
    }

    res.json({
      success: true,
      output: bestOutput,
      agentId: agent.id,
      agentName: agent.name,
      model: bestModel,
      candidatesCount: candidates.length,
      orchestrated,
      duration: Date.now() - startTime,
    });
  } catch (err: any) {
    console.error(`[agents/${agent.id}/run] error:`, err?.message ?? err);
    res.status(500).json({
      error: "internal_error",
      message: err?.message ?? "Unknown error",
    });
  }
});

export default router;
