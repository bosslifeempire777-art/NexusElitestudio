/**
 * Usage & overage routes.
 *
 * GET  /api/usage              → monthly usage summary + plan limits + remaining credits
 * GET  /api/usage/records      → recent individual usage entries (for the activity log)
 * POST /api/usage/buy-overage  → start a Stripe one-time checkout for an overage build pack
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usageRecordsTable, overageCreditsTable, usersTable } from "@workspace/db/schema";
import { requireAuth } from "../middleware/auth.js";
import { getMonthlyUsage } from "../lib/usage.js";
import { getPlanLimits } from "./plans.js";
import { stripeService } from "../stripeService.js";
import { getUncachableStripeClient } from "../stripeClient.js";
import { nanoid } from "../lib/nanoid.js";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const summary = await getMonthlyUsage(req.auth!.userId, req.auth!.plan);
    res.json(summary);
  } catch (err: any) {
    console.error("[usage] summary error:", err);
    res.status(500).json({ error: "internal", message: err.message });
  }
});

router.get("/records", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const records = await db
      .select()
      .from(usageRecordsTable)
      .where(eq(usageRecordsTable.userId, req.auth!.userId))
      .orderBy(desc(usageRecordsTable.createdAt))
      .limit(limit);
    res.json(records);
  } catch (err: any) {
    console.error("[usage] records error:", err);
    res.status(500).json({ error: "internal", message: err.message });
  }
});

/**
 * Start a Stripe Checkout session to buy an overage build pack. The user
 * picks a `packSize` (e.g. 10 builds) and we charge their plan's per-build
 * overage price. Successful payment fires a webhook that grants the credit.
 */
router.post("/buy-overage", requireAuth, async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const userPlan = req.auth!.plan;
    const limits = getPlanLimits(userPlan) as any;

    if (!limits.overage || !limits.overagePricePerBuild) {
      res.status(400).json({
        error: "no_overage",
        message: `Your ${userPlan} plan doesn't support overage builds. Upgrade to Starter, Pro, or Elite to buy extras.`,
      });
      return;
    }

    const packSize = Math.max(1, Math.min(100, Number(req.body?.packSize) || 10));
    const pricePerBuildUsd = Number(limits.overagePricePerBuild);
    const totalCents = Math.round(packSize * pricePerBuildUsd * 100);

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
    if (!user) { res.status(404).json({ error: "not_found" }); return; }

    let customerId = (user as any).stripeCustomerId as string | undefined;
    if (!customerId) {
      const customer = await stripeService.createCustomer(user.email ?? `${userId}@nexuselite.local`, userId);
      await db.update(usersTable)
        .set({ stripeCustomerId: customer.id } as any)
        .where(eq(usersTable.id, userId));
      customerId = customer.id;
    }

    const domain = process.env.CUSTOM_DOMAIN
      || process.env.REPLIT_DOMAINS?.split(",")[0]
      || process.env.REPLIT_DEV_DOMAIN
      || "localhost";
    const baseUrl = `https://${domain}`;

    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${packSize} Build Pack — ${userPlan} overage`,
              description: `${packSize} additional AI builds for your ${userPlan} plan, $${pricePerBuildUsd.toFixed(2)} each.`,
            },
            unit_amount: totalCents,
          },
          quantity: 1,
        },
      ],
      // {CHECKOUT_SESSION_ID} is replaced by Stripe so /usage can claim the pack
      success_url: `${baseUrl}/usage?overage=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/usage?overage=cancel`,
      metadata: {
        userId,
        kind: "overage_builds",
        packSize: String(packSize),
        plan: userPlan,
      },
    });

    // Pre-create a "pending" credit record we can flip to active in the webhook
    await db.insert(overageCreditsTable).values({
      id: nanoid(),
      userId,
      builds: packSize,
      buildsUsed: 0,
      amountPaidCents: totalCents,
      stripeSessionId: session.id,
      status: "pending",
    });

    res.json({ url: session.url, sessionId: session.id, packSize, totalCents });
  } catch (err: any) {
    console.error("[usage] buy-overage error:", err);
    res.status(500).json({ error: "internal", message: err.message });
  }
});

/**
 * Claim a completed overage purchase. The dashboard `?overage=success` page
 * calls this with the session ID; we verify with Stripe that it's paid and
 * flip the matching pending credit record to active.
 */
router.post("/claim-overage", requireAuth, async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId) { res.status(400).json({ error: "session_id_required" }); return; }

    const credit = await db.query.overageCreditsTable.findFirst({
      where: eq(overageCreditsTable.stripeSessionId, sessionId),
    });
    if (!credit || credit.userId !== userId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (credit.status === "active") { res.json({ ok: true, alreadyActive: true, credit }); return; }

    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      res.status(402).json({ error: "not_paid", paymentStatus: session.payment_status });
      return;
    }

    await db.update(overageCreditsTable)
      .set({ status: "active" })
      .where(eq(overageCreditsTable.id, credit.id));

    res.json({ ok: true, credit: { ...credit, status: "active" } });
  } catch (err: any) {
    console.error("[usage] claim-overage error:", err);
    res.status(500).json({ error: "internal", message: err.message });
  }
});

export default router;
