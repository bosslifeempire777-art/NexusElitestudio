/**
 * Usage tracking + overage helpers.
 *
 * Each AI-powered build (project create, rebuild, code-changing chat) is
 * recorded in `usage_records`. Monthly totals are compared against the user's
 * plan limits — when exceeded, the user is prompted to buy overage credits
 * (one-time Stripe Checkout) before more builds run.
 */

import { db } from "@workspace/db";
import { usageRecordsTable, overageCreditsTable } from "@workspace/db/schema";
import { and, eq, gte, sum, sql } from "drizzle-orm";
import { nanoid } from "./nanoid.js";
import { getPlanLimits } from "../routes/plans.js";

export type UsageKind = "build" | "rebuild" | "chat_change" | "chat_only" | "ai_call";

export async function recordUsage(opts: {
  userId: string;
  projectId?: string | null;
  kind: UsageKind;
  units?: number;
  tokensIn?: number;
  tokensOut?: number;
  costCents?: number;
  model?: string;
  description?: string;
}): Promise<void> {
  try {
    await db.insert(usageRecordsTable).values({
      id: nanoid(),
      userId: opts.userId,
      projectId: opts.projectId ?? null,
      kind: opts.kind,
      units: opts.units ?? 1,
      tokensIn: opts.tokensIn ?? 0,
      tokensOut: opts.tokensOut ?? 0,
      costCents: opts.costCents ?? 0,
      model: opts.model ?? null,
      description: opts.description ?? null,
    });
  } catch (err) {
    console.warn("[usage] recordUsage failed:", err);
  }
}

function startOfMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
}

/**
 * Get the user's current-month usage summary plus their plan limits and
 * any unused overage credits they've purchased.
 */
export async function getMonthlyUsage(userId: string, plan: string) {
  const since = startOfMonth();
  const limits = getPlanLimits(plan);

  const rows = await db
    .select({
      kind: usageRecordsTable.kind,
      total: sum(usageRecordsTable.units).mapWith(Number),
      tokensIn: sum(usageRecordsTable.tokensIn).mapWith(Number),
      tokensOut: sum(usageRecordsTable.tokensOut).mapWith(Number),
      costCents: sum(usageRecordsTable.costCents).mapWith(Number),
    })
    .from(usageRecordsTable)
    .where(and(eq(usageRecordsTable.userId, userId), gte(usageRecordsTable.createdAt, since)))
    .groupBy(usageRecordsTable.kind);

  // "build" units = anything that triggered code generation
  const buildKinds = new Set<UsageKind>(["build", "rebuild", "chat_change"]);
  let buildsThisMonth = 0;
  let tokensThisMonth = 0;
  let costCentsThisMonth = 0;
  for (const r of rows) {
    if (buildKinds.has(r.kind as UsageKind)) buildsThisMonth += r.total ?? 0;
    tokensThisMonth += (r.tokensIn ?? 0) + (r.tokensOut ?? 0);
    costCentsThisMonth += r.costCents ?? 0;
  }

  // Unused overage credits (purchased extra builds)
  const credits = await db
    .select({
      builds: sum(overageCreditsTable.builds).mapWith(Number),
      used: sum(overageCreditsTable.buildsUsed).mapWith(Number),
    })
    .from(overageCreditsTable)
    .where(and(eq(overageCreditsTable.userId, userId), eq(overageCreditsTable.status, "active")));

  const purchasedBuilds = credits[0]?.builds ?? 0;
  const usedOverageBuilds = credits[0]?.used ?? 0;
  const remainingOverageBuilds = Math.max(0, purchasedBuilds - usedOverageBuilds);

  const buildsLimit = limits.buildsPerMonth;
  const planBuildsRemaining = buildsLimit === -1 ? -1 : Math.max(0, buildsLimit - buildsThisMonth);
  const totalBuildsRemaining =
    buildsLimit === -1 ? -1 : planBuildsRemaining + remainingOverageBuilds;

  return {
    plan,
    periodStart: since.toISOString(),
    builds: {
      used: buildsThisMonth,
      limit: buildsLimit,
      planRemaining: planBuildsRemaining,
      overageRemaining: remainingOverageBuilds,
      overagePurchased: purchasedBuilds,
      totalRemaining: totalBuildsRemaining,
    },
    tokens: {
      used: tokensThisMonth,
      limit: limits.aiUsageTokens,
    },
    estimatedCostCents: costCentsThisMonth,
    overageAllowed: !!(limits as any).overage,
    overagePricePerBuildUsd: (limits as any).overagePricePerBuild ?? null,
  };
}

/**
 * Returns whether the user can perform a billable build right now, and if
 * not, why. Caller can present an upgrade/overage prompt to the user.
 */
export async function canPerformBuild(
  userId: string,
  plan: string,
): Promise<
  | { allowed: true; reason?: undefined }
  | { allowed: false; reason: "plan_limit" | "overage_required"; usage: Awaited<ReturnType<typeof getMonthlyUsage>> }
> {
  const usage = await getMonthlyUsage(userId, plan);
  if (usage.builds.limit === -1) return { allowed: true };
  if (usage.builds.totalRemaining > 0) return { allowed: true };
  if (usage.overageAllowed) return { allowed: false, reason: "overage_required", usage };
  return { allowed: false, reason: "plan_limit", usage };
}

/**
 * Consume one overage credit (called AFTER a build that exceeded plan quota
 * but had purchased credits available). Atomic-ish: increments builds_used.
 */
export async function consumeOverageCreditIfNeeded(userId: string, plan: string): Promise<void> {
  const usage = await getMonthlyUsage(userId, plan);
  if (usage.builds.limit === -1) return;
  // Only consume an overage credit if plan quota is exhausted
  if (usage.builds.planRemaining > 0) return;
  if (usage.builds.overageRemaining <= 0) return;

  // Atomic claim: increment builds_used by 1 only on the oldest pack that
  // still has room. Using a single UPDATE with a sub-select ID prevents two
  // concurrent builds from both reading "remaining > 0" and double-spending.
  await db.execute(sql`
    UPDATE overage_credits
       SET builds_used = builds_used + 1
     WHERE id = (
       SELECT id FROM overage_credits
        WHERE user_id = ${userId}
          AND status = 'active'
          AND builds_used < builds
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
  `);
}
