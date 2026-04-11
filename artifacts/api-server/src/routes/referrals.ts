import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, referralsTable, creditTransactionsTable } from "@workspace/db/schema";
import { eq, desc, count, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { nanoid } from "../lib/nanoid.js";

const router: IRouter = Router();

const DOMAIN = "nexuselitestudio.nexus";

const CREDIT_RULES = {
  signup:    50,
  converted: 200,
  monthly:   100,
};

const REDEMPTION_OPTIONS = [
  { id: "starter_month", label: "1 Month Starter",  cost: 580,  plan: "starter", months: 1 },
  { id: "pro_month",     label: "1 Month Pro",      cost: 1200, plan: "pro",     months: 1 },
  { id: "elite_month",   label: "1 Month Elite",    cost: 5380, plan: "elite",   months: 1 },
];

function generateReferralCode(username: string): string {
  const clean = username.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 10);
  const suffix = nanoid().slice(0, 4).toLowerCase();
  return `${clean}-${suffix}`;
}

async function ensureReferralCode(userId: string, username: string): Promise<string> {
  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
  if (user?.referralCode) return user.referralCode;
  const code = generateReferralCode(username);
  await db.update(usersTable).set({ referralCode: code }).where(eq(usersTable.id, userId));
  return code;
}

router.get("/me", requireAuth, async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const username = req.auth!.username;
    const code = await ensureReferralCode(userId, username);

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });

    const referrals = await db.select().from(referralsTable)
      .where(eq(referralsTable.referrerId, userId))
      .orderBy(desc(referralsTable.createdAt));

    const [{ total: totalSignups }] = await db.select({ total: count() })
      .from(referralsTable).where(eq(referralsTable.referrerId, userId));

    const [{ total: totalConverted }] = await db.select({ total: count() })
      .from(referralsTable).where(and(
        eq(referralsTable.referrerId, userId),
        eq(referralsTable.status, "converted"),
      ));

    const transactions = await db.select().from(creditTransactionsTable)
      .where(eq(creditTransactionsTable.userId, userId))
      .orderBy(desc(creditTransactionsTable.createdAt))
      .limit(20);

    res.json({
      referralCode: code,
      referralLink: `https://${DOMAIN}?ref=${code}`,
      creditBalance: user?.creditBalance ?? 0,
      stats: {
        totalSignups: Number(totalSignups),
        totalConverted: Number(totalConverted),
      },
      creditRules: CREDIT_RULES,
      redemptionOptions: REDEMPTION_OPTIONS,
      referrals,
      transactions,
    });
  } catch (err) {
    console.error("GET /referrals/me error:", err);
    res.status(500).json({ error: "Failed to load referral data" });
  }
});

router.post("/redeem", requireAuth, async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const { optionId } = req.body as { optionId?: string };

    const option = REDEMPTION_OPTIONS.find(o => o.id === optionId);
    if (!option) {
      res.status(400).json({ error: "Invalid redemption option" });
      return;
    }

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    if ((user.creditBalance ?? 0) < option.cost) {
      res.status(400).json({ error: `Not enough credits. Need ${option.cost}, have ${user.creditBalance}` });
      return;
    }

    await db.update(usersTable).set({
      creditBalance: (user.creditBalance ?? 0) - option.cost,
      plan: option.plan,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, userId));

    await db.insert(creditTransactionsTable).values({
      id: nanoid(),
      userId,
      amount: -option.cost,
      type: "redemption",
      description: `Redeemed ${option.label}`,
    });

    res.json({ ok: true, newBalance: (user.creditBalance ?? 0) - option.cost, plan: option.plan });
  } catch (err) {
    console.error("POST /referrals/redeem error:", err);
    res.status(500).json({ error: "Redemption failed" });
  }
});

export { CREDIT_RULES, generateReferralCode, ensureReferralCode };
export default router;
