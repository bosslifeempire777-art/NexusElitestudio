import app from "./app";
import { ensureAdminAccount } from "./seed-admin.js";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { startRenderPoller } from "./lib/render-poller.js";
import { checkStripeConfig } from "./lib/stripe-config-check.js";

/**
 * GLOBAL CRASH GUARDS.
 *
 * Prior to this, a single unhandled promise rejection — most commonly an
 * `AbortSignal.timeout()` firing after an OpenRouter request had already
 * settled — would terminate the entire API server (Node 24 default
 * behaviour for `unhandledRejection`). The process would then enter a
 * crash loop and every in-flight HTTP request would be dropped, which
 * the front-end surfaced to users as "lost connection to server".
 *
 * Catching them here lets the server keep serving everyone else even
 * when one request misbehaves. We log loudly so the underlying bug is
 * still visible in the deployment logs.
 */
// `unhandledRejection` is the one that was killing us — these are almost
// always orphan timer / abort rejections that have already been handled
// elsewhere in the request flow, so logging-and-continuing is safe and
// is what stops the production crash loop.
process.on("unhandledRejection", (reason: unknown) => {
  const err = reason as { message?: string; stack?: string; name?: string } | undefined;
  console.error(
    "[unhandledRejection] swallowed — server will keep running.",
    err?.name ?? "",
    err?.message ?? reason,
  );
  if (err?.stack) console.error(err.stack);
});

// `uncaughtException` is different — it usually means application state
// is genuinely corrupted, so we log loudly and exit. The platform
// (Render / Replit Deployments) will restart us with a clean process.
// We delay the exit briefly so the log line actually flushes to stdout.
process.on("uncaughtException", (err: Error) => {
  console.error(
    "[uncaughtException] FATAL — process will exit and be restarted.",
    err?.message,
  );
  if (err?.stack) console.error(err.stack);
  setTimeout(() => process.exit(1), 250).unref();
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * stripe-replit-sync ships its own SQL migrations that create the
 * `stripe.*` schema (accounts, customers, subscriptions, ...). On a
 * fresh production database those tables don't exist yet, so the
 * webhook handler's call into `sync.processWebhook` was logging
 * `relation "stripe.accounts" does not exist`. Run the migrations
 * once at startup so that schema exists. Idempotent — safe to run
 * on every boot.
 */
function ensureStripeSyncSchema(): void {
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) return;
  if (!process.env["STRIPE_SECRET_KEY"] && !process.env["REPLIT_CONNECTORS_HOSTNAME"]) {
    // No Stripe credentials configured at all — nothing to mirror.
    return;
  }

  // Fire-and-forget with a generous upper bound so a hanging Postgres
  // handshake can never block the API server from coming online (the
  // server is already listening before this runs). The webhook handler
  // is already defensive: if the schema isn't ready yet,
  // sync.processWebhook simply errors and the rest of the webhook still
  // runs.
  //
  // The previous bound was 20s, but a fresh production database has 50+
  // migrations to apply over a network connection, and the timeout was
  // firing every boot before any of them committed — leaving the
  // `stripe.*` schema permanently empty. 5 minutes is plenty of headroom
  // for the initial run; subsequent boots are near-instant because
  // pg-node-migrations skips already-applied migrations.
  const HARD_TIMEOUT_MS = 5 * 60_000;
  void (async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const { runMigrations } = await import("stripe-replit-sync");
      const guarded = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`runMigrations exceeded ${HARD_TIMEOUT_MS / 1000}s`)),
          HARD_TIMEOUT_MS,
        );
        if (typeof timer.unref === "function") timer.unref();
      });
      await Promise.race([runMigrations({ databaseUrl: dbUrl }), guarded]);
      console.log("✓ stripe-replit-sync schema verified");
    } catch (err: any) {
      console.warn(
        "[stripe-sync] migrations skipped:",
        err?.message ?? err,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
}

/**
 * On startup, any projects stuck in "building" state from a previous server
 * session will never complete (the async build process died with the server).
 * Mark them as "failed" so users can see them and trigger a rebuild.
 */
async function recoverStuckBuilds(): Promise<void> {
  try {
    const stuck = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.status, "building"));

    if (stuck.length === 0) return;

    console.log(`⚠️  Recovering ${stuck.length} stuck build(s)...`);

    for (const p of stuck) {
      await db
        .update(projectsTable)
        .set({
          status: "failed",
          agentLogs: ["[Orchestrator] ⚠️ Build was interrupted by a server restart.", "[Orchestrator] Click Rebuild to regenerate your project."],
          updatedAt: new Date(),
        })
        .where(eq(projectsTable.id, p.id));
      console.log(`  ↳ Marked "${p.name}" (${p.id}) as failed`);
    }
  } catch (err) {
    console.error("recoverStuckBuilds error:", err);
  }
}

app.listen(port, async () => {
  console.log(`Server listening on port ${port}`);
  await ensureAdminAccount();
  await ensureStripeSyncSchema();
  await recoverStuckBuilds();
  startRenderPoller();
  // Best-effort Stripe sanity check — verifies key mode and that all
  // configured price IDs exist in the same mode. Logs only; never throws.
  void checkStripeConfig().catch(err =>
    console.warn("[stripe-config] check failed:", err?.message ?? err),
  );
});
