import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, or } from "drizzle-orm";
import { nanoid } from "../lib/nanoid.js";
import { signToken, requireAuth } from "../middleware/auth.js";

const router: IRouter = Router();

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
    createdAt: user.createdAt.toISOString(),
  };
}

router.post("/register", async (req, res) => {
  const { username, email, password } = req.body as {
    username?: string;
    email?: string;
    password?: string;
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

  const valid = await bcrypt.compare(password, user.passwordHash);
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
