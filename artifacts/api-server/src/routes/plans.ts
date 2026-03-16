import { Router, type IRouter } from "express";

const router: IRouter = Router();

const PLANS = [
  {
    id: "free",
    name: "free",
    displayName: "Free",
    price: 0,
    billingPeriod: "monthly",
    features: [
      "5 builds per month",
      "3 projects max",
      "Basic AI agents",
      "Community support",
      "Web deployment (limited)",
    ],
    limits: { buildsPerMonth: 5, deployments: 1, aiUsageTokens: 50000, projects: 3, teamMembers: 1 },
  },
  {
    id: "pro",
    name: "pro",
    displayName: "Pro",
    price: 49,
    billingPeriod: "monthly",
    features: [
      "Unlimited builds",
      "50 projects",
      "All AI agents",
      "Full deployment access",
      "Advanced AI tools",
      "Priority support",
      "Custom domains",
      "Game studio mode",
    ],
    limits: { buildsPerMonth: -1, deployments: 50, aiUsageTokens: 5000000, projects: 50, teamMembers: 3 },
  },
  {
    id: "enterprise",
    name: "enterprise",
    displayName: "Enterprise",
    price: 199,
    billingPeriod: "monthly",
    features: [
      "Unlimited everything",
      "Team collaboration",
      "Private infrastructure",
      "SLA guarantee",
      "Custom AI models",
      "White-label options",
      "Dedicated support",
      "Custom integrations",
    ],
    limits: { buildsPerMonth: -1, deployments: -1, aiUsageTokens: -1, projects: -1, teamMembers: 20 },
  },
  {
    id: "vip",
    name: "vip",
    displayName: "VIP Access",
    price: 0,
    billingPeriod: "monthly",
    features: [
      "Full platform access",
      "Unlimited usage",
      "Free deployments",
      "VIP badge",
      "Early access to features",
      "Direct founder access",
    ],
    limits: { buildsPerMonth: -1, deployments: -1, aiUsageTokens: -1, projects: -1, teamMembers: -1 },
  },
];

router.get("/", (_req, res) => {
  res.json(PLANS);
});

export default router;
