import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "../lib/nanoid.js";

const router: IRouter = Router();

router.get("/me", async (req, res) => {
  const userId = req.headers["x-user-id"] as string || "demo-user";

  let user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  });

  if (!user) {
    const [newUser] = await db.insert(usersTable).values({
      id: userId,
      username: "demo_user",
      email: "demo@aistudio.dev",
      plan: "pro",
      isAdmin: true,
      isVip: false,
      projectCount: 0,
      buildsThisMonth: 0,
    }).returning();
    user = newUser;
  }

  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    plan: user.plan,
    isAdmin: user.isAdmin,
    isVip: user.isVip,
    projectCount: user.projectCount,
    buildsThisMonth: user.buildsThisMonth,
    createdAt: user.createdAt.toISOString(),
  });
});

export default router;
