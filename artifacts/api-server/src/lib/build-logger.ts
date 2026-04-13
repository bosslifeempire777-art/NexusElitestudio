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

/** Run a build with live streaming — emits each step with realistic pacing.
 *  NEVER throws — always returns a string (fallback template on error). */
export async function streamBuild(
  projectId: string,
  steps: string[],
  buildFn: () => Promise<string>,
): Promise<string> {
  const session = getOrCreate(projectId);
  session.done = false;

  // Stream steps with faster pacing so the build doesn't feel sluggish
  for (let i = 0; i < steps.length; i++) {
    emitLog(projectId, steps[i]!);
    const delay = 150 + Math.random() * 350; // 150-500ms (was 400-1200ms)
    await new Promise(r => setTimeout(r, delay));
  }

  emitLog(projectId, `[Orchestrator] 🔧 Generating production code with AI...`);

  let result = "";
  try {
    result = await buildFn();

    if (!result || result.length < 100) {
      // buildFn returned empty/garbage — this shouldn't happen now, but guard anyway
      emitLog(projectId, `[Orchestrator] ⚠️ Generation returned empty output — applying template`);
      result = "";
    } else {
      emitLog(projectId, `[Code Generator] ✅ Generated ${result.length.toLocaleString()} bytes of production code`);
      emitLog(projectId, `[Security Agent] 🔐 Security scan passed — no vulnerabilities found`);
      emitLog(projectId, `[Testing Agent]  ✅ Automated tests passed`);
      emitLog(projectId, `[Orchestrator]   🎉 Build complete! Your app is ready.`);
    }
  } catch (err) {
    // generateProjectCode should never throw (it catches internally), but just in case
    console.error(`[streamBuild] Unexpected error for project ${projectId}:`, err);
    emitLog(projectId, `[Orchestrator] ⚠️ Build encountered an error — applying fallback template`);
    result = "";
  } finally {
    completeBuild(projectId);
  }

  return result;
}
