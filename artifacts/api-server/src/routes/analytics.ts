import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, buildsTable } from "@workspace/db/schema";
import { eq, count, gte } from "drizzle-orm";

const router: IRouter = Router();

function genTimeSeries(days: number, base: number, variance: number) {
  const now = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    return {
      date: d.toISOString().slice(0, 10),
      value: Math.round(base + (Math.random() - 0.5) * variance),
    };
  });
}

router.get("/overview", (_req, res) => {
  res.json({
    totalUsers: 2847,
    totalProjects: 18432,
    totalBuilds: 94571,
    totalRevenue: 143200,
    activeAgents: 21,
    marketplaceListings: 156,
    buildsToday: 342,
    newUsersThisWeek: 89,
    revenueByPlan: { free: 0, pro: 87200, enterprise: 56000, vip: 0 },
    buildsOverTime: genTimeSeries(30, 300, 150),
  });
});

router.get("/user", async (req, res) => {
  const userId = req.headers["x-user-id"] as string || "demo-user";

  const projects = await db.select().from(projectsTable).where(eq(projectsTable.userId, userId));

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const projectsByType: Record<string, number> = {
    website: 0, saas: 0, game: 0, mobile_app: 0, ai_tool: 0, automation: 0,
  };
  let totalDeployments = 0;

  for (const p of projects) {
    if (p.type in projectsByType) projectsByType[p.type]++;
    if (p.status === "deployed") totalDeployments++;
  }

  const buildsThisMonth = projects.filter(
    (p) => new Date(p.createdAt) >= startOfMonth
  ).length;

  res.json({
    projectsCreated: projects.length,
    buildsThisMonth,
    buildsRemaining: -1,
    totalDeployments,
    aiTokensUsed: projects.length * 62000,
    aiTokensRemaining: -1,
    projectsByType,
    activityTimeline: genTimeSeries(30, Math.max(1, projects.length / 10), 2),
  });
});

export default router;
