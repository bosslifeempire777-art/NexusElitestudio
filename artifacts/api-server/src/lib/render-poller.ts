import { db } from "@workspace/db";
import { deploymentsTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { isRenderConfigured, getRenderServiceStatus } from "./render.js";

const POLL_INTERVAL_MS = Number(process.env["RENDER_POLL_INTERVAL_MS"] || 30_000);
const ACTIVE_STATUSES = ["provisioning", "building"];

let timer: NodeJS.Timeout | null = null;
let running = false;

async function pollOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!isRenderConfigured()) return;

    const inFlight = await db
      .select()
      .from(deploymentsTable)
      .where(inArray(deploymentsTable.status, ACTIVE_STATUSES));

    if (inFlight.length === 0) return;

    for (const dep of inFlight) {
      if (!dep.providerServiceId) continue;

      const status = await getRenderServiceStatus(dep.providerServiceId);
      if (!status.ok) continue;

      let newStatus = dep.status;
      let errorMessage: string | null = dep.errorMessage;
      switch (status.state) {
        case "live":
          newStatus = "live";
          errorMessage = null;
          break;
        case "build_failed":
        case "update_failed":
        case "canceled":
        case "deactivated":
          newStatus = "failed";
          errorMessage = `Render reported state: ${status.state}`;
          break;
        case "created":
        case "build_in_progress":
        case "update_in_progress":
        case "pre_deploy_in_progress":
          newStatus = "provisioning";
          break;
        default:
          break;
      }

      // Skip the write if nothing meaningful changed
      const liveUrlChanged =
        status.serviceUrl && status.serviceUrl !== dep.providerLiveUrl;
      if (newStatus === dep.status && !liveUrlChanged) continue;

      const now = new Date();
      await db
        .update(deploymentsTable)
        .set({
          status: newStatus,
          providerLiveUrl: status.serviceUrl ?? dep.providerLiveUrl,
          errorMessage,
          lastDeployedAt: newStatus === "live" ? now : dep.lastDeployedAt,
          updatedAt: now,
          buildLogs: [
            ...(Array.isArray(dep.buildLogs) ? (dep.buildLogs as string[]) : []),
            `[${now.toISOString()}] 🛰 Auto-poll: Render → ${status.state ?? "unknown"}`,
          ],
        })
        .where(eq(deploymentsTable.id, dep.id));
    }
  } catch (err) {
    console.error("[renderPoller] error:", err);
  } finally {
    running = false;
  }
}

/**
 * Start a background loop that polls Render for the status of any deployment
 * currently in a non-terminal state (provisioning / building) and updates
 * the database accordingly. Runs every RENDER_POLL_INTERVAL_MS (default 30s).
 */
export function startRenderPoller(): void {
  if (timer) return; // already started
  if (!isRenderConfigured()) {
    console.log("[renderPoller] RENDER_API_KEY not set — poller disabled");
    return;
  }
  console.log(`[renderPoller] started (every ${POLL_INTERVAL_MS}ms)`);
  // Kick off an immediate run so users don't wait a full interval after restart
  void pollOnce();
  timer = setInterval(() => {
    void pollOnce();
  }, POLL_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopRenderPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
