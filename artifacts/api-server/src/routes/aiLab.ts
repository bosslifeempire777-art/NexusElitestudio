/**
 * AI Lab routes — buy prompt packs, run prompts against curated models,
 * inspect history, and get a "graduate" referral link to a chosen provider.
 *
 *   GET  /api/ai-lab/balance          → { remaining }
 *   GET  /api/ai-lab/packs            → list user's packs (purchase history)
 *   GET  /api/ai-lab/runs             → recent runs
 *   GET  /api/ai-lab/models?type=...  → recommended model roster for an app type
 *   GET  /api/ai-lab/providers        → graduation links for every supported provider
 *   POST /api/ai-lab/buy-pack         → start Stripe checkout for a pack
 *   POST /api/ai-lab/claim-pack       → claim pack after Stripe success
 *   POST /api/ai-lab/run              → run a single prompt against 1 or 3 models
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { aiLabPacksTable, aiLabRunsTable, usersTable } from "@workspace/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { stripeService } from "../stripeService.js";
import { getUncachableStripeClient } from "../stripeClient.js";
import { nanoid } from "../lib/nanoid.js";
import {
  PROMPT_PACKS, PROVIDER_LINKS, getPack, getRemainingPrompts,
  consumePrompts, getModelsForAppType, runModels,
} from "../lib/aiLab.js";

const router: IRouter = Router();

router.get("/balance", requireAuth, async (req, res) => {
  try {
    const remaining = await getRemainingPrompts(req.auth!.userId);
    res.json({ remaining, packs: PROMPT_PACKS });
  } catch (err: any) {
    res.status(500).json({ error: "internal", message: err.message });
  }
});

router.get("/packs", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(aiLabPacksTable)
      .where(eq(aiLabPacksTable.userId, req.auth!.userId))
      .orderBy(desc(aiLabPacksTable.createdAt))
      .limit(50);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: "internal", message: err.message });
  }
});

router.get("/runs", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = await db
      .select()
      .from(aiLabRunsTable)
      .where(eq(aiLabRunsTable.userId, req.auth!.userId))
      .orderBy(desc(aiLabRunsTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: "internal", message: err.message });
  }
});

router.get("/models", requireAuth, async (req, res) => {
  const appType = String(req.query.type || "saas");
  res.json({
    appType,
    models: getModelsForAppType(appType),
    allTypes: ["saas", "website", "ai_tool", "mobile_app", "automation", "game"],
  });
});

router.get("/providers", requireAuth, (_req, res) => {
  res.json(PROVIDER_LINKS);
});

router.post("/buy-pack", requireAuth, async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const packId = String(req.body?.packId || "");
    const pack = getPack(packId);
    if (!pack) {
      res.status(400).json({ error: "invalid_pack", message: `Unknown pack "${packId}". Valid: ${PROMPT_PACKS.map(p => p.id).join(", ")}.` });
      return;
    }

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
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: pack.label,
            description: `${pack.prompts.toLocaleString()} AI test prompts in NexusElite AI Lab. Use across 6+ frontier models from OpenAI, Anthropic, Google, Meta, Mistral, and DeepSeek.`,
          },
          unit_amount: pack.priceCents,
        },
        quantity: 1,
      }],
      success_url: `${baseUrl}/ai-lab?pack=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/ai-lab?pack=cancel`,
      metadata: {
        userId,
        kind: "ai_lab_pack",
        packId: pack.id,
        prompts: String(pack.prompts),
      },
    });

    // Pre-create pending pack — flipped to active by /claim-pack after Stripe confirms.
    await db.insert(aiLabPacksTable).values({
      id: nanoid(),
      userId,
      promptsTotal: pack.prompts,
      promptsRemaining: pack.prompts,
      amountPaidCents: pack.priceCents,
      stripeSessionId: session.id,
      status: "pending",
    });

    res.json({ url: session.url, sessionId: session.id, pack });
  } catch (err: any) {
    console.error("[ai-lab] buy-pack error:", err);
    res.status(500).json({ error: "internal", message: err.message });
  }
});

router.post("/claim-pack", requireAuth, async (req, res) => {
  try {
    const userId    = req.auth!.userId;
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId) { res.status(400).json({ error: "session_id_required" }); return; }

    const pack = await db.query.aiLabPacksTable.findFirst({
      where: eq(aiLabPacksTable.stripeSessionId, sessionId),
    });
    if (!pack || pack.userId !== userId) { res.status(404).json({ error: "not_found" }); return; }
    if (pack.status === "active" || pack.status === "exhausted") {
      res.json({ ok: true, alreadyActive: true, pack });
      return;
    }

    const stripe  = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      res.status(402).json({ error: "not_paid", paymentStatus: session.payment_status });
      return;
    }

    await db.update(aiLabPacksTable)
      .set({ status: "active" })
      .where(eq(aiLabPacksTable.id, pack.id));

    res.json({ ok: true, pack: { ...pack, status: "active" } });
  } catch (err: any) {
    console.error("[ai-lab] claim-pack error:", err);
    res.status(500).json({ error: "internal", message: err.message });
  }
});

router.post("/run", requireAuth, async (req, res) => {
  try {
    const userId    = req.auth!.userId;
    const prompt    = String(req.body?.prompt || "").trim();
    const mode      = String(req.body?.mode || "single") === "compare" ? "compare" : "single";
    const appType   = String(req.body?.appType || "saas");
    const projectId = req.body?.projectId ? String(req.body.projectId) : null;

    if (!prompt) { res.status(400).json({ error: "prompt_required" }); return; }
    if (prompt.length > 4000) { res.status(400).json({ error: "prompt_too_long", message: "Max 4000 chars per prompt." }); return; }

    const roster = getModelsForAppType(appType);
    const models = mode === "compare" ? roster.slice(0, 3) : roster.slice(0, 1);
    const cost   = models.length;

    const balanceBefore = await getRemainingPrompts(userId);
    if (balanceBefore < cost) {
      res.status(402).json({
        error: "insufficient_prompts",
        message: `This run needs ${cost} prompt${cost > 1 ? "s" : ""}; you have ${balanceBefore}. Buy a pack to continue.`,
        remaining: balanceBefore, required: cost,
      });
      return;
    }

    const ok = await consumePrompts(userId, cost);
    if (!ok) {
      res.status(402).json({ error: "insufficient_prompts", message: "Could not reserve prompts — try again." });
      return;
    }

    const t0 = Date.now();
    const responses = await runModels(models, prompt);
    const durationMs = Date.now() - t0;

    // If every model failed, refund the prompts so the user isn't charged for a server error.
    const allFailed = responses.every(r => !r.ok);
    if (allFailed) {
      // Atomic refund: increment the most-recently-deducted pack (even if it was just
      // exhausted by this run) and bump status back to 'active'. Single SQL statement,
      // row-locked, so concurrent refunds never lose updates.
      try {
        await db.execute(sql`
          UPDATE ai_lab_packs
             SET prompts_remaining = prompts_remaining + ${cost},
                 status            = 'active'
           WHERE id = (
             SELECT id FROM ai_lab_packs
              WHERE user_id = ${userId}
                AND prompts_remaining < prompts_total
              ORDER BY created_at DESC
              LIMIT 1
              FOR UPDATE
           )
        `);
      } catch (refundErr) {
        console.warn("[ai-lab] refund failed:", refundErr);
      }
    }

    const runId = nanoid();
    await db.insert(aiLabRunsTable).values({
      id: runId,
      userId,
      projectId,
      prompt,
      mode,
      appType,
      models: models as any,
      responses: responses as any,
      promptsConsumed: allFailed ? 0 : cost,
      durationMs,
    });

    const remainingAfter = await getRemainingPrompts(userId);

    res.json({
      runId,
      mode, appType,
      models, responses, durationMs,
      promptsConsumed: allFailed ? 0 : cost,
      remaining: remainingAfter,
      refunded: allFailed,
    });
  } catch (err: any) {
    console.error("[ai-lab] run error:", err);
    res.status(500).json({ error: "internal", message: err.message });
  }
});

export default router;
