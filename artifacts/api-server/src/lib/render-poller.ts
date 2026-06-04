import { db } from "@workspace/db";
import { deploymentsTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { isRenderConfigured, getRenderServiceStatus } from "./render.js";
import { isVercelConfigured, getVercelDeploymentStatus } from "./vercel.js";

const POLL_INTERVAL_MS = Number(process.env["RENDER_POLL_INTERVAL_MS"] || 30_000);
const ACTIVE_STATUSES = ["provisioning", "building"];

let timer: NodeJS.Timeout | null = null;
let running = false;

async function pollOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const inFlight = await db
      .select()
      .from(deploymentsTable)
      .where(inArray(deploymentsTable.status, ACTIVE_STATUSES));

    if (inFlight.length === 0) return;

    for (const dep of inFlight) {
      if (!dep.providerServiceId) continue;

      if (dep.provider === "vercel") {
        if (!isVercelConfigured()) continue;
        const status = await getVercelDeploymentStatus(dep.providerServiceId);
        if (!status.ok) continue;

        let newStatus = dep.status;
        let errorMessage: string | null = dep.errorMessage;
        switch (status.readyState) {
          case "READY":
            newStatus = "live";
            errorMessage = null;
            break;
          case "ERROR":
          case "CANCELED":
            newStatus = "failed";
            errorMessage = `Vercel: ${status.readyState}`;
            break;
          case "INITIALIZING":
          case "BUILDING":
          case "QUEUED":
            newStatus = "provisioning";
            break;
          default:
            break;
        }

        const liveUrlChanged = status.url && status.url !== dep.providerLiveUrl;
        if (newStatus === dep.status && !liveUrlChanged) continue;

        const now = new Date();
        await db
          .update(deploymentsTable)
          .set({
            status: newStatus,
            providerLiveUrl: status.url ?? dep.providerLiveUrl,
            errorMessage,
            lastDeployedAt: newStatus === "live" ? now : dep.lastDeployedAt,
            updatedAt: now,
            buildLogs: [
              ...(Array.isArray(dep.buildLogs) ? (dep.buildLogs as string[]) : []),
              `[${now.toISOString()}] 🛰 Auto-poll: Vercel → ${status.readyState ?? "unknown"}`,
            ],
          })
          .where(eq(deploymentsTable.id, dep.id));

      } else if (dep.provider === "render") {
        if (!isRenderConfigured()) continue;
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

        const liveUrlChanged = status.serviceUrl && status.serviceUrl !== dep.providerLiveUrl;
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
    }
  } catch (err) {
    console.error("[deploymentPoller] error:", err);
  } finally {
    running = false;
  }
}

/**
 * Start a background loop that polls Vercel/Render for the status of any
 * deployment currently in a non-terminal state and updates the database.
 * Runs every RENDER_POLL_INTERVAL_MS (default 30s).
 */
export function startRenderPoller(): void {
  if (timer) return;
  const hasAnyProvider = isVercelConfigured() || isRenderConfigured();
  if (!hasAnyProvider) {
    console.log("[deploymentPoller] No provider tokens set — poller disabled");
    return;
  }
  console.log(`[deploymentPoller] started (every ${POLL_INTERVAL_MS}ms)`);
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
