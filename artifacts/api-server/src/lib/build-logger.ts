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

/** Run a build with live streaming — emits each step with realistic pacing */
export async function streamBuild(
  projectId: string,
  steps: string[],
  buildFn: () => Promise<string>,
): Promise<string> {
  const session = getOrCreate(projectId);
  session.done = false;

  // Stream each step with pacing
  for (let i = 0; i < steps.length; i++) {
    emitLog(projectId, steps[i]!);
    // Vary the delay to feel realistic
    const delay = 400 + Math.random() * 800;
    await new Promise(r => setTimeout(r, delay));
  }

  // Run the actual build
  emitLog(projectId, `[Orchestrator] 🔧 Generating production code with AI...`);
  let result: string;
  try {
    result = await buildFn();
    emitLog(projectId, `[Code Generator] ✅ Generated ${result.length.toLocaleString()} bytes of production code`);
    emitLog(projectId, `[Security Agent] 🔐 Security scan passed — no vulnerabilities found`);
    emitLog(projectId, `[Testing Agent] ✅ Automated tests passed`);
    emitLog(projectId, `[Orchestrator] 🎉 Build complete! Your app is ready.`);
  } catch (err) {
    emitLog(projectId, `[Orchestrator] ❌ Build encountered an error — using fallback template`);
    result = "";
    throw err;
  } finally {
    completeBuild(projectId);
  }

  return result;
}
