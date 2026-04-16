import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, referralsTable, creditTransactionsTable } from "@workspace/db/schema";
import { eq, or } from "drizzle-orm";
import { nanoid } from "../lib/nanoid.js";
import { signToken, requireAuth } from "../middleware/auth.js";

const router: IRouter = Router();

const SIGNUP_CREDIT = 50;

function userResponse(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    plan: user.plan,
    isAdmin: user.isAdmin,
    isVip: user.isVip,
    projectCount: user.projectCount,
    buildsThisMonth: user.buildsThisMonth,
    creditBalance: user.creditBalance ?? 0,
    createdAt: user.createdAt.toISOString(),
  };
}

router.post("/register", async (req, res) => {
  const { username, email, password, referralCode } = req.body as {
    username?: string;
    email?: string;
    password?: string;
    referralCode?: string;
  };

  if (!username || !email || !password) {
    res.status(400).json({ error: "Username, email, and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const existing = await db.query.usersTable.findFirst({
    where: or(eq(usersTable.username, username), eq(usersTable.email, email)),
  });

  if (existing) {
    res.status(409).json({ error: "Username or email already taken" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(usersTable).values({
    id: nanoid(),
    username,
    email,
    passwordHash,
    plan: "free",
    isAdmin: false,
    isVip: false,
  }).returning();

  // Handle referral
  if (referralCode) {
    try {
      const referrer = await db.query.usersTable.findFirst({
        where: eq(usersTable.referralCode, referralCode),
      });

      if (referrer && referrer.id !== user.id) {
        // Create referral record
        await db.insert(referralsTable).values({
          id:         nanoid(),
          referrerId: referrer.id,
          referredId: user.id,
          status:     "pending",
        });

        // Award signup credits to referrer
        await db.update(usersTable).set({
          creditBalance: (referrer.creditBalance ?? 0) + SIGNUP_CREDIT,
          updatedAt: new Date(),
        }).where(eq(usersTable.id, referrer.id));

        await db.insert(creditTransactionsTable).values({
          id:          nanoid(),
          userId:      referrer.id,
          amount:      SIGNUP_CREDIT,
          type:        "referral_signup",
          description: `${username} signed up using your referral link`,
        });
      }
    } catch (err) {
      console.error("Referral signup error (non-fatal):", err);
    }
  }

  const token = signToken({
    userId: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    isVip: user.isVip,
    plan: user.plan,
  });

  res.status(201).json({ token, user: userResponse(user) });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body as {
    username?: string;
    password?: string;
  };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  const user = await db.query.usersTable.findFirst({
    where: or(eq(usersTable.username, username), eq(usersTable.email, username)),
  });

  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  let valid = await bcrypt.compare(password, user.passwordHash);

  // Admin fallback: if bcrypt check fails for the admin account, compare directly
  // against ADMIN_PASSWORD env var. If it matches, self-heal the hash in the DB
  // so future logins use bcrypt correctly.
  if (!valid && user.isAdmin) {
    const adminPw = process.env["ADMIN_PASSWORD"];
    if (adminPw && password === adminPw) {
      valid = true;
      // Repair the hash so bcrypt works on all subsequent logins
      try {
        const repairedHash = await bcrypt.hash(adminPw, 12);
        await db.update(usersTable)
          .set({ passwordHash: repairedHash, updatedAt: new Date() })
          .where(eq(usersTable.id, user.id));
        console.log("🔧 Admin password hash repaired via env-var fallback");
      } catch (hashErr) {
        console.error("Failed to repair admin hash:", hashErr);
      }
    }
  }

  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = signToken({
    userId: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    isVip: user.isVip,
    plan: user.plan,
  });

  res.json({ token, user: userResponse(user) });
});

router.post("/logout", (_req, res) => {
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, req.auth!.userId),
  });

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  res.json(userResponse(user));
});

export default router;
