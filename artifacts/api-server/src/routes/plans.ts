import { Router, type IRouter } from "express";

const router: IRouter = Router();

/* ─── Plan definitions ─────────────────────────────────────────────────────
   Limits: -1 = unlimited
   stripeProductName must match exactly what you create in your Stripe dashboard
────────────────────────────────────────────────────────────────────────── */
export const PLANS = [
  {
    id: "free",
    name: "free",
    displayName: "Free",
    price: 0,
    billingPeriod: "monthly",
    color: "default",
    tagline: "Try it out",
    features: [
      "1 build per month",
      "2 projects max",
      "Core AI agents (5 of 21)",
      "Live preview (not deployable)",
      "Community support",
    ],
    limits: {
      buildsPerMonth: 1,
      projects: 2,
      deployments: 0,
      aiUsageTokens: 30_000,
      teamMembers: 1,
      marketplaceAccess: false,
      gameStudio: false,
      customDomain: false,
      overage: false,
    },
  },
  {
    id: "starter",
    name: "starter",
    displayName: "Starter",
    price: 29,
    billingPeriod: "monthly",
    color: "primary",
    tagline: "For indie builders",
    stripePriceId: process.env.STRIPE_PRICE_STARTER || "",
    features: [
      "20 builds per month",
      "10 projects",
      "All 21 AI agents",
      "Full deployment & custom domains",
      "Game studio mode",
      "Priority email support",
      "Overage: $2 per extra build",
    ],
    limits: {
      buildsPerMonth: 20,
      projects: 10,
      deployments: 20,
      aiUsageTokens: 500_000,
      teamMembers: 1,
      marketplaceAccess: false,
      gameStudio: true,
      customDomain: true,
      overage: true,
      overagePricePerBuild: 2,
    },
  },
  {
    id: "pro",
    name: "pro",
    displayName: "Pro",
    price: 60,
    billingPeriod: "monthly",
    color: "accent",
    tagline: "For serious creators",
    stripePriceId: process.env.STRIPE_PRICE_PRO || "",
    recommended: true,
    features: [
      "75 builds per month",
      "30 projects",
      "All 21 AI agents + priority queue",
      "Unlimited deployments",
      "Full game studio + asset generator",
      "Marketplace listing (sell your apps & games)",
      "Marketing & promotion tools",
      "Custom domains + SSL",
      "Priority support",
      "Overage: $1.50 per extra build",
    ],
    limits: {
      buildsPerMonth: 75,
      projects: 30,
      deployments: -1,
      aiUsageTokens: 2_000_000,
      teamMembers: 3,
      marketplaceAccess: true,
      gameStudio: true,
      customDomain: true,
      overage: true,
      overagePricePerBuild: 1.5,
    },
  },
  {
    id: "elite",
    name: "elite",
    displayName: "Elite",
    price: 269,
    billingPeriod: "monthly",
    color: "gold",
    tagline: "Large scale & enterprise",
    stripePriceId: process.env.STRIPE_PRICE_ELITE || "",
    features: [
      "Unlimited builds",
      "Unlimited projects",
      "All 21 AI agents — maximum priority",
      "Unlimited deployments",
      "Full game studio + multiplayer support",
      "Featured marketplace placement",
      "Dedicated marketing campaigns",
      "White-label options",
      "Team collaboration (up to 10 seats)",
      "Dedicated account manager",
      "Custom AI model integrations",
      "SLA uptime guarantee",
    ],
    limits: {
      buildsPerMonth: -1,
      projects: -1,
      deployments: -1,
      aiUsageTokens: -1,
      teamMembers: 10,
      marketplaceAccess: true,
      gameStudio: true,
      customDomain: true,
      overage: false,
    },
  },
  {
    id: "vip",
    name: "vip",
    displayName: "VIP Access",
    price: 0,
    billingPeriod: "monthly",
    color: "violet",
    tagline: "Owner-granted access",
    features: [
      "Everything in Elite — free",
      "Unlimited builds & projects",
      "VIP badge on profile",
      "Early access to new features",
      "Direct founder support",
    ],
    limits: {
      buildsPerMonth: -1,
      projects: -1,
      deployments: -1,
      aiUsageTokens: -1,
      teamMembers: -1,
      marketplaceAccess: true,
      gameStudio: true,
      customDomain: true,
      overage: false,
    },
  },
];

/* Quick lookup: plan limits by plan name */
export function getPlanLimits(planName: string) {
  return PLANS.find(p => p.name === planName)?.limits ?? PLANS[0]!.limits;
}

router.get("/", (_req, res) => {
  res.json(PLANS);
});

export default router;
