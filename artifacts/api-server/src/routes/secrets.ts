import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { userSecretsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "../lib/nanoid.js";
import { requireAuth } from "../middleware/auth.js";

const router: IRouter = Router();
router.use(requireAuth);

/** Mask a secret value: keep first 3 + last 3 chars, replace middle with dots. */
function maskValue(v: string): string {
  if (!v) return "";
  if (v.length <= 8) return "•".repeat(v.length);
  return `${v.slice(0, 3)}${"•".repeat(Math.min(v.length - 6, 12))}${v.slice(-3)}`;
}

/** Normalise a secret name to UPPER_SNAKE_CASE so it can be used as a JS identifier. */
function normaliseName(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/** GET /api/secrets — list current user's secrets (values masked). */
router.get("/", async (req, res) => {
  const userId = req.auth!.userId;
  const rows = await db
    .select()
    .from(userSecretsTable)
    .where(eq(userSecretsTable.userId, userId))
    .orderBy(desc(userSecretsTable.updatedAt));

  res.json(
    rows.map((s) => ({
      id: s.id,
      name: s.name,
      maskedValue: maskValue(s.value),
      length: s.value.length,
      category: s.category,
      description: s.description,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  );
});

/** POST /api/secrets — create a new secret. */
router.post("/", async (req, res) => {
  const userId = req.auth!.userId;
  const { name, value, category, description } = req.body as {
    name?: string;
    value?: string;
    category?: string;
    description?: string;
  };

  if (!name || !value) {
    res.status(400).json({ error: "name and value are required" });
    return;
  }

  const normalised = normaliseName(name);
  if (!normalised) {
    res.status(400).json({ error: "name must contain at least one alphanumeric character" });
    return;
  }
  if (value.length > 8000) {
    res.status(400).json({ error: "value too large (max 8000 chars)" });
    return;
  }

  const existing = await db.query.userSecretsTable.findFirst({
    where: and(eq(userSecretsTable.userId, userId), eq(userSecretsTable.name, normalised)),
  });
  if (existing) {
    res.status(409).json({ error: `A secret named "${normalised}" already exists. Edit it or pick a different name.` });
    return;
  }

  const [created] = await db
    .insert(userSecretsTable)
    .values({
      id: nanoid(),
      userId,
      name: normalised,
      value,
      category: (category || "general").trim().toLowerCase().slice(0, 32) || "general",
      description: description?.slice(0, 500) ?? null,
    })
    .returning();

  res.status(201).json({
    id: created.id,
    name: created.name,
    maskedValue: maskValue(created.value),
    length: created.value.length,
    category: created.category,
    description: created.description,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  });
});

/** PUT /api/secrets/:id — update value/description/category (name is immutable). */
router.put("/:id", async (req, res) => {
  const userId = req.auth!.userId;
  const { value, category, description } = req.body as {
    value?: string;
    category?: string;
    description?: string;
  };

  const existing = await db.query.userSecretsTable.findFirst({
    where: and(eq(userSecretsTable.id, req.params.id), eq(userSecretsTable.userId, userId)),
  });
  if (!existing) {
    res.status(404).json({ error: "Secret not found" });
    return;
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof value === "string") {
    if (!value) {
      res.status(400).json({ error: "value cannot be empty (delete the secret instead)" });
      return;
    }
    if (value.length > 8000) {
      res.status(400).json({ error: "value too large (max 8000 chars)" });
      return;
    }
    patch.value = value;
  }
  if (typeof category === "string") patch.category = category.trim().toLowerCase().slice(0, 32) || "general";
  if (typeof description === "string") patch.description = description.slice(0, 500);

  const [updated] = await db
    .update(userSecretsTable)
    .set(patch)
    .where(eq(userSecretsTable.id, req.params.id))
    .returning();

  res.json({
    id: updated.id,
    name: updated.name,
    maskedValue: maskValue(updated.value),
    length: updated.value.length,
    category: updated.category,
    description: updated.description,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

/** DELETE /api/secrets/:id */
router.delete("/:id", async (req, res) => {
  const userId = req.auth!.userId;
  const result = await db
    .delete(userSecretsTable)
    .where(and(eq(userSecretsTable.id, req.params.id), eq(userSecretsTable.userId, userId)))
    .returning({ id: userSecretsTable.id });
  if (result.length === 0) {
    res.status(404).json({ error: "Secret not found" });
    return;
  }
  res.status(204).send();
});

/**
 * GET /api/secrets/reveal/:id — return the FULL value of the user's own secret.
 * Used by the settings UI when the user clicks "Show". Never returns other users' values.
 */
router.get("/reveal/:id", async (req, res) => {
  const userId = req.auth!.userId;
  const row = await db.query.userSecretsTable.findFirst({
    where: and(eq(userSecretsTable.id, req.params.id), eq(userSecretsTable.userId, userId)),
  });
  if (!row) {
    res.status(404).json({ error: "Secret not found" });
    return;
  }
  res.json({ id: row.id, name: row.name, value: row.value });
});

/**
 * Internal helper used by the project preview & code generation routes.
 * Returns ALL secret name+value pairs for the given user as a plain map.
 */
export async function getUserSecretsMap(userId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ name: userSecretsTable.name, value: userSecretsTable.value })
    .from(userSecretsTable)
    .where(eq(userSecretsTable.userId, userId));
  const out: Record<string, string> = {};
  for (const r of rows) out[r.name] = r.value;
  return out;
}

/**
 * Internal helper: returns secret NAMES only (never values). Used to feed the
 * AI a list of available keys so it can wire generated code to use them by name.
 */
export async function getUserSecretNames(userId: string): Promise<string[]> {
  const rows = await db
    .select({ name: userSecretsTable.name })
    .from(userSecretsTable)
    .where(eq(userSecretsTable.userId, userId));
  return rows.map((r) => r.name);
}

export default router;
