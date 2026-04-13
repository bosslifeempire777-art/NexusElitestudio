import app from "./app";
import { ensureAdminAccount } from "./seed-admin.js";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
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
  await recoverStuckBuilds();
});
