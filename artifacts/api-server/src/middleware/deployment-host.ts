import { type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { deploymentsTable, customDomainsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const BRAND_DOMAIN = (process.env["NEXUS_BRAND_DOMAIN"] || "nexuseliteaistudio.nexus").toLowerCase();

/**
 * Routes traffic that arrives via a branded subdomain (slug.brand.tld) or a
 * verified custom domain to the matching project's preview.
 *
 * Logic:
 *   - Strip port and lowercase the Host header.
 *   - If host === apex brand domain or `www.<brand>` → no rewrite (main app).
 *   - If host ends with `.<brand>` → look up by slug.
 *   - Otherwise, look up custom_domains table.
 *   - If a match is found, internally rewrite the request URL to the
 *     project's preview endpoint and continue.
 */
export function deploymentHost() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      // Skip API and asset paths
      if (req.path.startsWith("/api/") || req.path.startsWith("/assets/")) return next();

      const rawHost = (req.headers.host || "").toLowerCase().split(":")[0];
      if (!rawHost) return next();
      if (rawHost === BRAND_DOMAIN || rawHost === `www.${BRAND_DOMAIN}`) return next();
      if (rawHost.endsWith(".repl.co") || rawHost.endsWith(".replit.dev") || rawHost.endsWith(".replit.app")) return next();
      if (rawHost === "localhost" || rawHost.endsWith(".localhost")) return next();

      let projectId: string | null = null;

      if (rawHost.endsWith(`.${BRAND_DOMAIN}`)) {
        const slug = rawHost.slice(0, -1 - BRAND_DOMAIN.length);
        if (slug && !slug.includes(".")) {
          const dep = await db.query.deploymentsTable.findFirst({
            where: eq(deploymentsTable.slug, slug),
          });
          if (dep && dep.status === "live") projectId = dep.projectId;
        }
      } else {
        const cd = await db.query.customDomainsTable.findFirst({
          where: eq(customDomainsTable.domain, rawHost),
        });
        if (cd && cd.status === "verified") {
          const dep = await db.query.deploymentsTable.findFirst({
            where: eq(deploymentsTable.id, cd.deploymentId),
          });
          if (dep && dep.status === "live") projectId = dep.projectId;
        }
      }

      if (projectId) {
        req.url = `/api/projects/${projectId}/preview`;
      }
      next();
    } catch (err) {
      console.error("[deploymentHost] error:", err);
      next();
    }
  };
}
