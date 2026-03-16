import { Router, type IRouter } from "express";

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
    revenueByPlan: {
      free: 0,
      pro: 87200,
      enterprise: 56000,
      vip: 0,
    },
    buildsOverTime: genTimeSeries(30, 300, 150),
  });
});

router.get("/user", (_req, res) => {
  res.json({
    projectsCreated: 12,
    buildsThisMonth: 47,
    buildsRemaining: -1,
    totalDeployments: 8,
    aiTokensUsed: 1240000,
    aiTokensRemaining: -1,
    projectsByType: {
      website: 3,
      saas: 4,
      game: 2,
      mobile_app: 1,
      ai_tool: 2,
      automation: 0,
    },
    activityTimeline: genTimeSeries(30, 2, 3),
  });
});

export default router;
