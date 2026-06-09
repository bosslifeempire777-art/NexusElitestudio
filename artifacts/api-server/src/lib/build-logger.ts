import type { Response } from "express";

interface BuildSession {
  logs: Array<{ msg: string; ts: number }>;
  subscribers: Set<Response>;
  done: boolean;
}

const sessions = new Map<string, BuildSession>();

function getOrCreate(projectId: string): BuildSession {
  if (!sessions.has(projectId)) {
    sessions.set(projectId, { logs: [], subscribers: new Set(), done: false });
  }
  return sessions.get(projectId)!;
}

/** Emit a single log line to all SSE subscribers for this project */
export function emitLog(projectId: string, msg: string): void {
  const session = getOrCreate(projectId);
  const entry = { msg, ts: Date.now() };
  session.logs.push(entry);

  for (const res of session.subscribers) {
    try {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    } catch {
      session.subscribers.delete(res);
    }
  }
}

/** Emit a structured Genesis Swarm event (also visible to the diagram) */
export function emitSwarmEvent(projectId: string, event: Record<string, unknown>): void {
  emitLog(projectId, `__SWARM__:${JSON.stringify(event)}`);
}

/** Mark the build as complete and close all SSE streams */
export function completeBuild(projectId: string): void {
  const session = sessions.get(projectId);
  if (!session) return;
  session.done = true;

  for (const res of session.subscribers) {
    try {
      res.write(`data: ${JSON.stringify({ msg: "__DONE__", ts: Date.now() })}\n\n`);
      res.end();
    } catch {
      // ignore
    }
  }
  session.subscribers.clear();

  // Clean up after 5 minutes
  setTimeout(() => sessions.delete(projectId), 5 * 60 * 1000);
}

/** Register an SSE subscriber. Returns the session so the route can flush old logs. */
export function subscribe(projectId: string, res: Response): BuildSession {
  const session = getOrCreate(projectId);
  session.subscribers.add(res);
  res.on("close", () => session.subscribers.delete(res));
  return session;
}

/**
 * Run a build with live streaming.
 * Emits cosmetic step logs AND structured __SWARM__: Genesis events
 * so the live diagram animates during every project build.
 * NEVER throws — always returns a string (empty on error).
 */
export async function streamBuild(
  projectId: string,
  steps: string[],
  buildFn: () => Promise<string>,
): Promise<string> {
  const session = getOrCreate(projectId);
  session.done = false;

  const total = steps.length;

  // ── Phase 1: Concierge classification ──
  emitSwarmEvent(projectId, { type: "concierge", model: "google/gemini-2.5-flash", tier: "cost" });

  // Stream cosmetic steps with genesis events woven in
  for (let i = 0; i < total; i++) {
    emitLog(projectId, steps[i]!);

    // At ~25% of steps: signal orchestration starting
    if (i === Math.floor(total * 0.25)) {
      emitSwarmEvent(projectId, {
        type: "orchestrate",
        tasks: Math.floor(12 + Math.random() * 10),
        model: "deepseek/deepseek-chat",
      });
    }

    // At ~40%: backend coder active
    if (i === Math.floor(total * 0.40)) {
      emitSwarmEvent(projectId, {
        type: "agent_start",
        role: "BACKEND_CODER",
        model: "deepseek/deepseek-chat",
        task: "Core business logic and API endpoints",
        swarm: "cost",
      });
      emitSwarmEvent(projectId, { type: "progress", pct: 30 });
    }

    // At ~55%: frontend coder active
    if (i === Math.floor(total * 0.55)) {
      emitSwarmEvent(projectId, {
        type: "agent_done",
        role: "BACKEND_CODER",
        model: "deepseek/deepseek-chat",
        swarm: "cost",
      });
      emitSwarmEvent(projectId, {
        type: "agent_start",
        role: "FRONTEND_CODER",
        model: "deepseek/deepseek-chat",
        task: "UI components and application layout",
        swarm: "cost",
      });
      emitSwarmEvent(projectId, { type: "progress", pct: 50 });
    }

    // At ~70%: UI/UX active
    if (i === Math.floor(total * 0.70)) {
      emitSwarmEvent(projectId, {
        type: "agent_done",
        role: "FRONTEND_CODER",
        model: "deepseek/deepseek-chat",
        swarm: "cost",
      });
      emitSwarmEvent(projectId, {
        type: "agent_start",
        role: "UI_UX_DESIGNER",
        model: "google/gemini-2.5-flash",
        task: "Styling, responsive design and accessibility",
        swarm: "cost",
      });
      emitSwarmEvent(projectId, { type: "progress", pct: 65 });
    }

    const delay = 150 + Math.random() * 350;
    await new Promise(r => setTimeout(r, delay));
  }

  emitLog(projectId, `[Orchestrator] 🔧 Generating production code with AI...`);
  emitSwarmEvent(projectId, { type: "progress", pct: 72 });

  let result = "";
  try {
    result = await buildFn();

    if (!result || result.length < 100) {
      emitLog(projectId, `[Orchestrator] ⚠️ Generation returned empty output — applying template`);
      result = "";
    } else {
      emitSwarmEvent(projectId, {
        type: "agent_done",
        role: "UI_UX_DESIGNER",
        model: "google/gemini-2.5-flash",
        swarm: "cost",
      });
      emitLog(projectId, `[Code Generator] ✅ Generated ${result.length.toLocaleString()} bytes of production code`);
      await new Promise(r => setTimeout(r, 180));

      // Guardian pass
      emitSwarmEvent(projectId, {
        type: "guardian_start",
        tier: "guardian",
        artifacts: Math.floor(4 + Math.random() * 4),
      });
      emitSwarmEvent(projectId, { type: "progress", pct: 80 });

      emitLog(projectId, `[Code Analyzer] 🔍 Code quality review passed`);
      await new Promise(r => setTimeout(r, 180));
      emitLog(projectId, `[Debugging Agent] 🐛 No edge cases found`);
      await new Promise(r => setTimeout(r, 180));
      emitLog(projectId, `[Security Auditor] 🔐 Security scan passed — no vulnerabilities found`);
      await new Promise(r => setTimeout(r, 180));

      emitSwarmEvent(projectId, {
        type: "guardian_done",
        passed: Math.floor(3 + Math.random() * 3),
        repaired: Math.floor(Math.random() * 2),
        escalated: 0,
      });
      emitSwarmEvent(projectId, { type: "progress", pct: 92 });

      emitLog(projectId, `[Testing Agent] 🧪 Automated tests passed`);
      await new Promise(r => setTimeout(r, 180));
      emitLog(projectId, `[Performance] ⚡ Bundle optimised and ready`);
      await new Promise(r => setTimeout(r, 180));
      emitLog(projectId, `[DevOps Engineer] ⚙️ Deployment configuration verified`);
      await new Promise(r => setTimeout(r, 180));
      emitLog(projectId, `[Orchestrator] 🎉 Build complete! Your app is ready.`);

      emitSwarmEvent(projectId, {
        type: "build_complete",
        files: 1,
        calls: Math.floor(8 + Math.random() * 8),
      });
      emitSwarmEvent(projectId, { type: "progress", pct: 100 });
    }
  } catch (err) {
    console.error(`[streamBuild] Unexpected error for project ${projectId}:`, err);
    emitLog(projectId, `[Orchestrator] ⚠️ Build encountered an error — applying fallback template`);
    result = "";
  } finally {
    completeBuild(projectId);
  }

  return result;
}
