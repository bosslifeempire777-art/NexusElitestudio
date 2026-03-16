import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "../lib/nanoid.js";

const router: IRouter = Router();

const DEMO_USERS = [
  { id: "demo-user", username: "demo_user", email: "demo@aistudio.dev", plan: "pro", isAdmin: true, isVip: false, projectCount: 12, buildsThisMonth: 47, createdAt: new Date("2025-01-15").toISOString() },
  { id: "user-alice", username: "alice_dev", email: "alice@example.com", plan: "enterprise", isAdmin: false, isVip: false, projectCount: 34, buildsThisMonth: 120, createdAt: new Date("2025-02-01").toISOString() },
  { id: "user-bob", username: "bob_games", email: "bob@example.com", plan: "pro", isAdmin: false, isVip: false, projectCount: 8, buildsThisMonth: 23, createdAt: new Date("2025-03-10").toISOString() },
  { id: "user-carol", username: "carol_saas", email: "carol@example.com", plan: "free", isAdmin: false, isVip: false, projectCount: 2, buildsThisMonth: 3, createdAt: new Date("2025-06-20").toISOString() },
  { id: "user-david", username: "david_vip", email: "david@example.com", plan: "vip", isAdmin: false, isVip: true, projectCount: 56, buildsThisMonth: 200, createdAt: new Date("2024-12-05").toISOString() },
  { id: "user-eve", username: "eve_builder", email: "eve@example.com", plan: "pro", isAdmin: false, isVip: false, projectCount: 15, buildsThisMonth: 67, createdAt: new Date("2025-04-18").toISOString() },
];

router.get("/", (_req, res) => {
  const { plan } = _req.query as { plan?: string };
  let users = DEMO_USERS;
  if (plan) users = users.filter((u) => u.plan === plan);
  res.json(users);
});

router.get("/:id", (req, res) => {
  const user = DEMO_USERS.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "not_found", message: "User not found" });
  res.json(user);
});

router.patch("/:id", (req, res) => {
  const user = DEMO_USERS.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "not_found", message: "User not found" });
  const { plan, isAdmin } = req.body;
  const updated = { ...user, ...(plan ? { plan } : {}), ...(isAdmin !== undefined ? { isAdmin } : {}) };
  res.json(updated);
});

router.post("/:id/grant-vip", (req, res) => {
  const user = DEMO_USERS.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "not_found", message: "User not found" });
  res.json({ ...user, isVip: true, plan: "vip" });
});

export default router;
