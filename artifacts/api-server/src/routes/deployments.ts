import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { deploymentsTable, customDomainsTable, projectsTable, usersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "../lib/nanoid.js";
import { requireAuth } from "../middleware/auth.js";
import { getPlanLimits } from "./plans.js";
import { isRenderConfigured, pingRender, addCustomDomainToService } from "../lib/render.js";

const router: IRouter = Router();

const BRAND_DOMAIN = process.env["NEXUS_BRAND_DOMAIN"] || "nexuselitestudio.com";
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "app";
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  let attempt = 0;
  while (true) {
    const existing = await db.query.deploymentsTable.findFirst({
      where: eq(deploymentsTable.slug, candidate),
    });
    if (!existing) return candidate;
    attempt += 1;
    candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (attempt > 8) {
      candidate = `${base}-${nanoid().slice(0, 6).toLowerCase()}`;
      return candidate;
    }
  }
}

function deploymentResponse(d: typeof deploymentsTable.$inferSelect, domains: (typeof customDomainsTable.$inferSelect)[] = []) {
  return {
    ...d,
    buildLogs: Array.isArray(d.buildLogs) ? d.buildLogs : [],
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    lastDeployedAt: d.lastDeployedAt.toISOString(),
    customDomains: domains.map((cd) => ({
      ...cd,
      verifiedAt: cd.verifiedAt?.toISOString() ?? null,
      lastCheckedAt: cd.lastCheckedAt?.toISOString() ?? null,
      createdAt: cd.createdAt.toISOString(),
    })),
  };
}

// ── Render integration health (admin/debug) ───────────────────────────────
router.get("/render/status", requireAuth, async (_req, res) => {
  if (!isRenderConfigured()) {
    res.json({ configured: false, ok: false, message: "RENDER_API_KEY not set" });
    return;
  }
  const ping = await pingRender();
  res.json({ configured: true, ...ping });
});

// ── List user's deployments ───────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const rows = isAdmin
    ? await db.select().from(deploymentsTable)
    : await db.select().from(deploymentsTable).where(eq(deploymentsTable.userId, userId));

  const domains = await db.select().from(customDomainsTable);
  const byDeployment = new Map<string, (typeof customDomainsTable.$inferSelect)[]>();
  for (const d of domains) {
    if (!byDeployment.has(d.deploymentId)) byDeployment.set(d.deploymentId, []);
    byDeployment.get(d.deploymentId)!.push(d);
  }

  res.json(rows.map((d) => deploymentResponse(d, byDeployment.get(d.id) ?? [])));
});

// ── Get single deployment ─────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const dep = await db.query.deploymentsTable.findFirst({
    where: isAdmin
      ? eq(deploymentsTable.id, req.params.id)
      : and(eq(deploymentsTable.id, req.params.id), eq(deploymentsTable.userId, userId)),
  });
  if (!dep) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const domains = await db
    .select()
    .from(customDomainsTable)
    .where(eq(customDomainsTable.deploymentId, dep.id));
  res.json(deploymentResponse(dep, domains));
});

// ── Create deployment for a project ───────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const isVip = req.auth!.isVip;
  const userPlan = req.auth!.plan;
  const { projectId, slug: requestedSlug } = req.body as { projectId?: string; slug?: string };

  if (!projectId) {
    res.status(400).json({ error: "bad_request", message: "projectId is required" });
    return;
  }

  const project = isAdmin
    ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, projectId) })
    : await db.query.projectsTable.findFirst({
        where: and(eq(projectsTable.id, projectId), eq(projectsTable.userId, userId)),
      });

  if (!project) {
    res.status(404).json({ error: "not_found", message: "Project not found" });
    return;
  }
  if (!project.generatedCode) {
    res.status(400).json({ error: "not_ready", message: "Project must finish building before it can be deployed" });
    return;
  }

  // Re-deploy: if a deployment exists for this project, refresh it.
  // We deliberately allow re-deploys even when the user is at quota (they're
  // not creating a NEW deployment, just re-deploying an existing one).
  const existing = await db.query.deploymentsTable.findFirst({
    where: and(eq(deploymentsTable.projectId, project.id), eq(deploymentsTable.userId, project.userId)),
  });

  // Plan gating only applies to NEW deployments (not re-deploys)
  if (!existing && !isAdmin && !isVip) {
    const limits = getPlanLimits(userPlan);
    if (limits.deployments === 0) {
      res.status(402).json({
        error: "plan_limit",
        code: "DEPLOY_NOT_ALLOWED",
        message: `Deployments are not available on the ${userPlan} plan. Upgrade to Starter or higher.`,
        currentPlan: userPlan,
      });
      return;
    }
    if (limits.deployments !== -1) {
      const userDeployments = await db
        .select()
        .from(deploymentsTable)
        .where(eq(deploymentsTable.userId, userId));
      if (userDeployments.length >= limits.deployments) {
        res.status(402).json({
          error: "plan_limit",
          code: "DEPLOY_LIMIT",
          message: `You've used all ${limits.deployments} deployments on the ${userPlan} plan. Delete an existing deployment or upgrade.`,
          currentPlan: userPlan,
          limit: limits.deployments,
          current: userDeployments.length,
        });
        return;
      }
    }
  }

  if (existing) {
    const [updated] = await db
      .update(deploymentsTable)
      .set({
        status: "live",
        errorMessage: null,
        lastDeployedAt: new Date(),
        updatedAt: new Date(),
        buildLogs: [
          ...(Array.isArray(existing.buildLogs) ? (existing.buildLogs as string[]) : []),
          `[${new Date().toISOString()}] Re-deployed from latest project code`,
        ],
      })
      .where(eq(deploymentsTable.id, existing.id))
      .returning();
    const domains = await db
      .select()
      .from(customDomainsTable)
      .where(eq(customDomainsTable.deploymentId, existing.id));
    res.status(200).json(deploymentResponse(updated!, domains));
    return;
  }

  // New deployment — pick slug
  const baseSlug = requestedSlug && SLUG_RE.test(requestedSlug)
    ? requestedSlug
    : slugify(project.name);
  const finalSlug = await uniqueSlug(baseSlug);

  const brandedUrl = `https://${finalSlug}.${BRAND_DOMAIN}`;
  const buildLogs: string[] = [
    `[${new Date().toISOString()}] 🚀 Deployment created`,
    `[${new Date().toISOString()}] 🌐 Branded URL assigned: ${brandedUrl}`,
    `[${new Date().toISOString()}] ✅ Routing live on Nexus Edge`,
  ];

  const [dep] = await db
    .insert(deploymentsTable)
    .values({
      id: nanoid(),
      projectId: project.id,
      userId: project.userId,
      slug: finalSlug,
      brandedUrl,
      provider: "nexus-edge",
      status: "live",
      buildLogs,
    })
    .returning();

  // Update the project's deployedUrl to the branded one for legacy UI
  await db
    .update(projectsTable)
    .set({ status: "deployed", deployedUrl: brandedUrl, updatedAt: new Date() })
    .where(eq(projectsTable.id, project.id));

  res.status(201).json(deploymentResponse(dep!));
});

// ── Delete deployment ─────────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const dep = await db.query.deploymentsTable.findFirst({
    where: isAdmin
      ? eq(deploymentsTable.id, req.params.id)
      : and(eq(deploymentsTable.id, req.params.id), eq(deploymentsTable.userId, userId)),
  });
  if (!dep) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await db.delete(customDomainsTable).where(eq(customDomainsTable.deploymentId, dep.id));
  await db.delete(deploymentsTable).where(eq(deploymentsTable.id, dep.id));
  res.status(204).send();
});

// ── Add custom domain ─────────────────────────────────────────────────────
router.post("/:id/domains", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const isVip = req.auth!.isVip;
  const userPlan = req.auth!.plan;
  const { domain } = req.body as { domain?: string };

  if (!domain || !DOMAIN_RE.test(domain)) {
    res.status(400).json({ error: "bad_request", message: "Provide a valid domain like myapp.example.com" });
    return;
  }

  if (!isAdmin && !isVip) {
    const limits = getPlanLimits(userPlan) as { customDomain?: boolean };
    if (!limits.customDomain) {
      res.status(402).json({
        error: "plan_limit",
        code: "CUSTOM_DOMAIN_NOT_ALLOWED",
        message: `Custom domains require the Starter plan or higher.`,
        currentPlan: userPlan,
      });
      return;
    }
  }

  const dep = await db.query.deploymentsTable.findFirst({
    where: isAdmin
      ? eq(deploymentsTable.id, req.params.id)
      : and(eq(deploymentsTable.id, req.params.id), eq(deploymentsTable.userId, userId)),
  });
  if (!dep) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const conflict = await db.query.customDomainsTable.findFirst({
    where: eq(customDomainsTable.domain, domain.toLowerCase()),
  });
  if (conflict) {
    res.status(409).json({ error: "conflict", message: "That domain is already registered" });
    return;
  }

  // If the deployment is on Render, register the domain there too.
  let verificationTarget: string | null = null;
  if (dep.providerServiceId && isRenderConfigured()) {
    const r = await addCustomDomainToService(dep.providerServiceId, domain.toLowerCase());
    if (r.ok) verificationTarget = r.verificationTarget ?? null;
  }
  // Default: instruct user to CNAME → branded subdomain
  if (!verificationTarget) verificationTarget = `${dep.slug}.${BRAND_DOMAIN}`;

  const [cd] = await db
    .insert(customDomainsTable)
    .values({
      id: nanoid(),
      deploymentId: dep.id,
      userId: dep.userId,
      domain: domain.toLowerCase(),
      status: "pending",
      verificationTarget,
    })
    .returning();

  res.status(201).json({
    ...cd,
    verifiedAt: cd!.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: cd!.lastCheckedAt?.toISOString() ?? null,
    createdAt: cd!.createdAt.toISOString(),
    instructions: {
      type: "CNAME",
      host: domain,
      target: verificationTarget,
      note: `Add a CNAME record at your DNS provider pointing ${domain} to ${verificationTarget}, then click Verify.`,
    },
  });
});

// ── Verify custom domain ─────────────────────────────────────────────────
router.post("/:id/domains/:domainId/verify", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const cd = await db.query.customDomainsTable.findFirst({
    where: isAdmin
      ? eq(customDomainsTable.id, req.params.domainId)
      : and(eq(customDomainsTable.id, req.params.domainId), eq(customDomainsTable.userId, userId)),
  });
  if (!cd) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  // DNS check via Node's dns/promises — strict FQDN match, no fuzzy substring
  let verified = false;
  let detail = "";
  const normalize = (h: string) => h.toLowerCase().replace(/\.+$/, "");
  const expected = normalize(cd.verificationTarget || "");
  try {
    const dns = await import("node:dns/promises");
    const cnames = await dns.resolveCname(cd.domain).catch(() => [] as string[]);
    if (Array.isArray(cnames) && cnames.length > 0) {
      verified = cnames.some((r) => normalize(r) === expected);
      detail = `Resolved CNAME: ${cnames.join(", ")}`;
      if (!verified) detail += `. Expected exactly: ${expected}`;
    } else {
      detail = "No CNAME record found yet — DNS can take up to 30 minutes to propagate. " +
        `Add: CNAME ${cd.domain} → ${expected}`;
    }
  } catch (err) {
    detail = err instanceof Error ? err.message : String(err);
  }

  const [updated] = await db
    .update(customDomainsTable)
    .set({
      status: verified ? "verified" : "pending",
      verifiedAt: verified ? new Date() : null,
      lastCheckedAt: new Date(),
    })
    .where(eq(customDomainsTable.id, cd.id))
    .returning();

  res.json({
    ...updated,
    verifiedAt: updated!.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: updated!.lastCheckedAt?.toISOString() ?? null,
    createdAt: updated!.createdAt.toISOString(),
    detail,
  });
});

// ── Remove custom domain ──────────────────────────────────────────────────
router.delete("/:id/domains/:domainId", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const isAdmin = req.auth!.isAdmin;
  const cd = await db.query.customDomainsTable.findFirst({
    where: isAdmin
      ? eq(customDomainsTable.id, req.params.domainId)
      : and(eq(customDomainsTable.id, req.params.domainId), eq(customDomainsTable.userId, userId)),
  });
  if (!cd) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await db.delete(customDomainsTable).where(eq(customDomainsTable.id, cd.id));
  res.status(204).send();
});

// Touch usersTable import so TS doesn't complain (used elsewhere in codebase)
void usersTable;

export default router;
export { BRAND_DOMAIN };
