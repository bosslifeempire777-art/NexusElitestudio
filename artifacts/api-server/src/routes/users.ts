import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

const router: IRouter = Router();

function userResponse(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    plan: u.plan,
    isAdmin: u.isAdmin,
    isVip: u.isVip,
    projectCount: u.projectCount,
    buildsThisMonth: u.buildsThisMonth,
    createdAt: u.createdAt.toISOString(),
  };
}

router.get("/", requireAdmin, async (req, res) => {
  const { plan } = req.query as { plan?: string };
  const users = await db.query.usersTable.findMany();
  const filtered = plan ? users.filter((u) => u.plan === plan) : users;
  res.json(filtered.map(userResponse));
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, id),
  });
  if (!user) {
    res.status(404).json({ error: "not_found", message: "User not found" });
    return;
  }
  if (!req.auth!.isAdmin && req.auth!.userId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(userResponse(user));
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const { plan, isAdmin, isVip } = req.body as {
    plan?: string;
    isAdmin?: boolean;
    isVip?: boolean;
  };
  const id = String(req.params.id);

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, id),
  });
  if (!user) {
    res.status(404).json({ error: "not_found", message: "User not found" });
    return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };
  if (plan !== undefined) updates.plan = plan;
  if (isAdmin !== undefined) updates.isAdmin = isAdmin;
  if (isVip !== undefined) updates.isVip = isVip;

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  res.json(userResponse(updated!));
});

router.post("/:id/grant-vip", requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, id),
  });
  if (!user) {
    res.status(404).json({ error: "not_found", message: "User not found" });
    return;
  }

  const [updated] = await db.update(usersTable)
    .set({ isVip: true, plan: "vip", updatedAt: new Date() })
    .where(eq(usersTable.id, id))
    .returning();

  res.json(userResponse(updated!));
});

router.post("/:id/revoke-vip", requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, id),
  });
  if (!user) {
    res.status(404).json({ error: "not_found", message: "User not found" });
    return;
  }

  const [updated] = await db.update(usersTable)
    .set({ isVip: false, plan: "free", updatedAt: new Date() })
    .where(eq(usersTable.id, id))
    .returning();

  res.json(userResponse(updated!));
});

export default router;
