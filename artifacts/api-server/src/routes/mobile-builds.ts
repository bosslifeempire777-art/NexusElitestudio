/**
 * /api/mobile-builds — EAS Build, OTA Update, Submit & Workflow routes
 *
 * All routes require authentication. Build triggers require Pro/Elite/VIP/admin.
 * Standard users can view their own builds and poll status.
 */

import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { mobileBuildTable, projectsTable } from "@workspace/db/schema";
import { requireAuth } from "../middleware/auth.js";
import { nanoid } from "../lib/nanoid.js";
import { triggerMobileBuild, getMobileBuildStatus } from "../lib/eas.js";
import { submitBuild, getSubmissionStatus } from "../lib/easSubmit.js";
import {
  publishOtaUpdate,
  listOtaUpdates,
  listChannels,
  listBranches,
} from "../lib/easUpdate.js";
import {
  listWorkflowRuns,
  triggerWorkflowRun,
  getWorkflowRunLogs,
  WORKFLOW_TEMPLATES,
} from "../lib/easWorkflows.js";

const router: IRouter = Router();
router.use(requireAuth);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** EAS project slug derived from a NexusElite project ID */
function easSlug(projectId: string): string {
  return `nexus-${projectId}`.slice(0, 60);
}

/** Guard: only Pro/Elite/VIP/admin can trigger builds/submits/publishes */
function canTrigger(req: any): boolean {
  const { plan, isAdmin, isVip } = req.auth!;
  return isAdmin || isVip || plan === "pro" || plan === "elite";
}

/** Verify the caller owns (or is admin of) a project, return it or null */
async function resolveProject(projectId: string, req: any) {
  const { userId, isAdmin } = req.auth!;
  return db.query.projectsTable.findFirst({
    where: isAdmin
      ? eq(projectsTable.id, projectId)
      : and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD HISTORY
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/mobile-builds — list all builds for the caller */
router.get("/", async (req, res) => {
  const { userId, isAdmin } = req.auth!;
  try {
    const rows = isAdmin
      ? await db.select().from(mobileBuildTable).orderBy(desc(mobileBuildTable.createdAt)).limit(100)
      : await db
          .select({ mb: mobileBuildTable })
          .from(mobileBuildTable)
          .innerJoin(projectsTable, eq(mobileBuildTable.projectId, projectsTable.id))
          .where(eq(projectsTable.userId, userId))
          .orderBy(desc(mobileBuildTable.createdAt))
          .limit(100)
          .then(r => r.map(x => x.mb));

    res.json({ builds: rows });
  } catch (err: any) {
    res.status(500).json({ error: "list_failed", message: err.message });
  }
});

/** GET /api/mobile-builds/project/:projectId — builds for a specific project */
router.get("/project/:projectId", async (req, res) => {
  const project = await resolveProject(req.params.projectId, req);
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const rows = await db
    .select()
    .from(mobileBuildTable)
    .where(eq(mobileBuildTable.projectId, project.id))
    .orderBy(desc(mobileBuildTable.createdAt))
    .limit(50);

  res.json({ builds: rows });
});

/** GET /api/mobile-builds/:buildId — single build record */
router.get("/:buildId", async (req, res) => {
  const { userId, isAdmin } = req.auth!;
  const row = await db.query.mobileBuildTable.findFirst({
    where: eq(mobileBuildTable.id, req.params.buildId),
  });
  if (!row) { res.status(404).json({ error: "not_found" }); return; }

  if (!isAdmin) {
    const project = await db.query.projectsTable.findFirst({
      where: and(eq(projectsTable.id, row.projectId), eq(projectsTable.userId, userId)),
    });
    if (!project) { res.status(403).json({ error: "forbidden" }); return; }
  }

  res.json(row);
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER A BUILD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/mobile-builds/project/:projectId/trigger
 * Body: { platform: "android"|"ios"|"all", files?: Record<string,string> }
 *
 * Queues an EAS build for the project. Returns one record per platform.
 * The build runs on EAS infrastructure — no Flutter needed here.
 */
router.post("/project/:projectId/trigger", async (req, res) => {
  if (!canTrigger(req)) {
    res.status(402).json({
      error: "plan_limit",
      message: "Mobile builds require Pro or Elite plan.",
    });
    return;
  }
  if (!process.env.EXPO_TOKEN) {
    res.status(503).json({ error: "not_configured", message: "EXPO_TOKEN is not set." });
    return;
  }

  const project = await resolveProject(req.params.projectId, req);
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const { platform = "android", files } = req.body as {
    platform?: "android" | "ios" | "all";
    files?:    Record<string, string>;
  };

  if (!["android", "ios", "all"].includes(platform)) {
    res.status(400).json({ error: "bad_request", message: "platform must be android, ios, or all" });
    return;
  }

  // Use files from request body if provided, otherwise use project's generated code
  const buildFiles: Record<string, string> = files ?? (
    project.generatedCode
      ? { "index.html": project.generatedCode }
      : {}
  );

  if (Object.keys(buildFiles).length === 0) {
    res.status(400).json({ error: "no_files", message: "No files to build. Generate the project first." });
    return;
  }

  try {
    const results = await triggerMobileBuild({
      projectId:   project.id,
      projectName: project.name,
      platform,
      files:       buildFiles,
    });

    // Persist each queued build to DB
    const rows = await Promise.all(
      results.map(async r => {
        const [row] = await db.insert(mobileBuildTable).values({
          id:          nanoid(),
          projectId:   project.id,
          easBuildId:  r.buildId,
          platform:    r.platform,
          status:      r.status,
          profile:     "preview",
          artifactUrl: r.artifactUrl,
          repoUrl:     r.repoUrl,
          logsUrl:     r.logsUrl,
          errorMessage: r.error,
        }).returning();
        return row;
      }),
    );

    res.status(202).json({ builds: rows });
  } catch (err: any) {
    res.status(502).json({ error: "eas_build_failed", message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POLL BUILD STATUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/mobile-builds/:buildId/poll
 * Fetches current status from EAS and syncs to DB.
 */
router.post("/:buildId/poll", async (req, res) => {
  if (!process.env.EXPO_TOKEN) {
    res.status(503).json({ error: "not_configured", message: "EXPO_TOKEN is not set." });
    return;
  }

  const { userId, isAdmin } = req.auth!;
  const row = await db.query.mobileBuildTable.findFirst({
    where: eq(mobileBuildTable.id, req.params.buildId),
  });
  if (!row) { res.status(404).json({ error: "not_found" }); return; }

  if (!isAdmin) {
    const project = await db.query.projectsTable.findFirst({
      where: and(eq(projectsTable.id, row.projectId), eq(projectsTable.userId, userId)),
    });
    if (!project) { res.status(403).json({ error: "forbidden" }); return; }
  }

  try {
    const status = await getMobileBuildStatus(row.easBuildId);

    const finished = ["finished", "errored", "cancelled", "expired"].includes(status.status);
    const [updated] = await db
      .update(mobileBuildTable)
      .set({
        status:      status.status,
        artifactUrl: status.artifactUrl ?? row.artifactUrl,
        logsUrl:     status.logsUrl    ?? row.logsUrl,
        errorMessage: status.error     ?? row.errorMessage,
        finishedAt:  finished && !row.finishedAt ? new Date() : row.finishedAt,
      })
      .where(eq(mobileBuildTable.id, row.id))
      .returning();

    res.json(updated);
  } catch (err: any) {
    res.status(502).json({ error: "poll_failed", message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STORE SUBMIT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/mobile-builds/:buildId/submit
 * Body: { platform: "android"|"ios" }
 * Submits a finished EAS build to the App Store / Play Store.
 */
router.post("/:buildId/submit", async (req, res) => {
  if (!canTrigger(req)) {
    res.status(402).json({ error: "plan_limit", message: "Store submission requires Pro or Elite plan." });
    return;
  }
  if (!process.env.EXPO_TOKEN) {
    res.status(503).json({ error: "not_configured", message: "EXPO_TOKEN is not set." });
    return;
  }

  const { userId, isAdmin } = req.auth!;
  const row = await db.query.mobileBuildTable.findFirst({
    where: eq(mobileBuildTable.id, req.params.buildId),
  });
  if (!row) { res.status(404).json({ error: "not_found" }); return; }

  if (!isAdmin) {
    const project = await db.query.projectsTable.findFirst({
      where: and(eq(projectsTable.id, row.projectId), eq(projectsTable.userId, userId)),
    });
    if (!project) { res.status(403).json({ error: "forbidden" }); return; }
  }

  const { platform } = req.body as { platform?: "android" | "ios" };
  const targetPlatform = (platform ?? row.platform) as "android" | "ios";

  try {
    const result = await submitBuild({ buildId: row.easBuildId, platform: targetPlatform });
    res.status(202).json(result);
  } catch (err: any) {
    res.status(502).json({ error: "submit_failed", message: err.message });
  }
});

/** GET /api/mobile-builds/submission/:submissionId — poll a store submission */
router.get("/submission/:submissionId", async (req, res) => {
  if (!process.env.EXPO_TOKEN) {
    res.status(503).json({ error: "not_configured", message: "EXPO_TOKEN is not set." });
    return;
  }
  try {
    const status = await getSubmissionStatus(req.params.submissionId);
    res.json(status);
  } catch (err: any) {
    res.status(502).json({ error: "poll_failed", message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// OTA UPDATES
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/mobile-builds/project/:projectId/ota — list OTA updates */
router.get("/project/:projectId/ota", async (req, res) => {
  const project = await resolveProject(req.params.projectId, req);
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const [updates, channels, branches] = await Promise.all([
    listOtaUpdates(easSlug(project.id)),
    listChannels(easSlug(project.id)),
    listBranches(easSlug(project.id)),
  ]);

  res.json({ updates, channels, branches });
});

/**
 * POST /api/mobile-builds/project/:projectId/ota/publish
 * Body: { branch: string, message: string, files?: Record<string,string> }
 */
router.post("/project/:projectId/ota/publish", async (req, res) => {
  if (!canTrigger(req)) {
    res.status(402).json({ error: "plan_limit", message: "OTA publish requires Pro or Elite plan." });
    return;
  }
  if (!process.env.EXPO_TOKEN) {
    res.status(503).json({ error: "not_configured", message: "EXPO_TOKEN is not set." });
    return;
  }

  const project = await resolveProject(req.params.projectId, req);
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const { branch = "main", message = "Update from NexusElite Studio", files } = req.body as {
    branch?:  string;
    message?: string;
    files?:   Record<string, string>;
  };

  const projectFiles: Record<string, string> = files ?? (
    project.generatedCode ? { "index.html": project.generatedCode } : {}
  );

  if (Object.keys(projectFiles).length === 0) {
    res.status(400).json({ error: "no_files", message: "No files to publish." });
    return;
  }

  try {
    const result = await publishOtaUpdate({
      easProjectSlug: easSlug(project.id),
      accountName:    "Nexuselitestudio",
      branch,
      message,
      projectFiles,
    });
    res.status(202).json(result);
  } catch (err: any) {
    res.status(502).json({ error: "ota_publish_failed", message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOWS (CI/CD)
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/mobile-builds/workflows/templates — built-in YAML templates */
router.get("/workflows/templates", (_req, res) => {
  res.json({ templates: WORKFLOW_TEMPLATES });
});

/** GET /api/mobile-builds/project/:projectId/workflows — list workflow runs */
router.get("/project/:projectId/workflows", async (req, res) => {
  const project = await resolveProject(req.params.projectId, req);
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const runs = await listWorkflowRuns(easSlug(project.id));
  res.json({ runs });
});

/**
 * POST /api/mobile-builds/project/:projectId/workflows/trigger
 * Body: { workflowName: string, yaml: string } OR { template: string }
 */
router.post("/project/:projectId/workflows/trigger", async (req, res) => {
  if (!canTrigger(req)) {
    res.status(402).json({ error: "plan_limit", message: "Workflow triggers require Pro or Elite plan." });
    return;
  }
  if (!process.env.EXPO_TOKEN) {
    res.status(503).json({ error: "not_configured", message: "EXPO_TOKEN is not set." });
    return;
  }

  const project = await resolveProject(req.params.projectId, req);
  if (!project) { res.status(404).json({ error: "not_found" }); return; }

  const { workflowName, yaml, template } = req.body as {
    workflowName?: string;
    yaml?:         string;
    template?:     string;
  };

  let resolvedName: string;
  let resolvedYaml: string;

  if (template) {
    const tpl = WORKFLOW_TEMPLATES[template];
    if (!tpl) {
      res.status(400).json({ error: "bad_request", message: `Unknown template "${template}". Available: ${Object.keys(WORKFLOW_TEMPLATES).join(", ")}` });
      return;
    }
    resolvedName = template;
    resolvedYaml = tpl.yaml;
  } else if (workflowName && yaml) {
    resolvedName = workflowName;
    resolvedYaml = yaml;
  } else {
    res.status(400).json({ error: "bad_request", message: "Provide either 'template' or both 'workflowName' and 'yaml'." });
    return;
  }

  try {
    const run = await triggerWorkflowRun({
      easProjectSlug: easSlug(project.id),
      accountName:    "Nexuselitestudio",
      workflowName:   resolvedName,
      yaml:           resolvedYaml,
    });
    res.status(202).json(run);
  } catch (err: any) {
    res.status(502).json({ error: "workflow_trigger_failed", message: err.message });
  }
});

/** GET /api/mobile-builds/workflows/:runId — logs + status for a workflow run */
router.get("/workflows/:runId", async (req, res) => {
  if (!process.env.EXPO_TOKEN) {
    res.status(503).json({ error: "not_configured", message: "EXPO_TOKEN is not set." });
    return;
  }
  try {
    const logs = await getWorkflowRunLogs(req.params.runId);
    res.json(logs);
  } catch (err: any) {
    res.status(502).json({ error: "logs_failed", message: err.message });
  }
});

export default router;
