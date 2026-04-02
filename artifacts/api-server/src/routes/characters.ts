import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { charactersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "../lib/nanoid.js";
import { requireAuth } from "../middleware/auth.js";

const router: IRouter = Router();

/* ─── List ─────────────────────────────────────────────── */
router.get("/", requireAuth, async (req, res) => {
  const { userId } = req.auth!;
  const { projectId, style } = req.query as { projectId?: string; style?: string };

  let rows = await db.select().from(charactersTable)
    .where(eq(charactersTable.userId, userId));

  if (projectId) rows = rows.filter(r => r.projectId === projectId);
  if (style)     rows = rows.filter(r => r.gameStyle === style);

  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  res.json(rows);
});

/* ─── Create / Save ─────────────────────────────────────── */
router.post("/", requireAuth, async (req, res) => {
  const { userId } = req.auth!;
  const { name, gameStyle, prompt, imageUrl, imageData, imageType, projectId, tags, notes } = req.body;

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const [character] = await db.insert(charactersTable).values({
    id: nanoid(),
    name,
    gameStyle: gameStyle || "cartoon",
    prompt:    prompt    || "",
    imageUrl:  imageUrl  || null,
    imageData: imageData || null,
    imageType: imageType || "ai-generated",
    userId,
    projectId: projectId || null,
    tags:      Array.isArray(tags) ? tags : [],
    notes:     notes || null,
  }).returning();

  res.status(201).json(character);
});

/* ─── Get one ────────────────────────────────────────────── */
router.get("/:id", requireAuth, async (req, res) => {
  const { userId } = req.auth!;
  const { isAdmin } = req.auth!;

  const character = isAdmin
    ? await db.query.charactersTable.findFirst({ where: eq(charactersTable.id, req.params.id) })
    : await db.query.charactersTable.findFirst({
        where: and(eq(charactersTable.id, req.params.id), eq(charactersTable.userId, userId)),
      });

  if (!character) { res.status(404).json({ error: "not_found" }); return; }
  res.json(character);
});

/* ─── Update ────────────────────────────────────────────── */
router.patch("/:id", requireAuth, async (req, res) => {
  const { userId } = req.auth!;
  const { name, gameStyle, prompt, imageUrl, imageData, imageType, tags, notes } = req.body;

  const existing = await db.query.charactersTable.findFirst({
    where: and(eq(charactersTable.id, req.params.id), eq(charactersTable.userId, userId)),
  });
  if (!existing) { res.status(404).json({ error: "not_found" }); return; }

  const [updated] = await db.update(charactersTable)
    .set({
      ...(name      != null && { name }),
      ...(gameStyle != null && { gameStyle }),
      ...(prompt    != null && { prompt }),
      ...(imageUrl  != null && { imageUrl }),
      ...(imageData != null && { imageData }),
      ...(imageType != null && { imageType }),
      ...(tags      != null && { tags }),
      ...(notes     != null && { notes }),
      updatedAt: new Date(),
    })
    .where(eq(charactersTable.id, req.params.id))
    .returning();

  res.json(updated);
});

/* ─── Delete ─────────────────────────────────────────────── */
router.delete("/:id", requireAuth, async (req, res) => {
  const { userId } = req.auth!;
  await db.delete(charactersTable)
    .where(and(eq(charactersTable.id, req.params.id), eq(charactersTable.userId, userId)));
  res.status(204).send();
});

/* ─── Generate: builds pollinations.ai URL from prompt + style ─ */
router.post("/generate", requireAuth, async (_req, res) => {
  const { prompt, style, width = 512, height = 512, seed } = _req.body;

  if (!prompt) { res.status(400).json({ error: "prompt is required" }); return; }

  const styleSuffix: Record<string, string> = {
    realistic:  ", photorealistic, detailed, 8k, cinematic lighting",
    anime:      ", anime style, cel shading, vibrant colors, Studio Ghibli inspired",
    cartoon:    ", cartoon style, bold outlines, bright colors, Pixar inspired",
    pixel:      ", pixel art, 16-bit, retro game sprite, transparent background",
    lowpoly:    ", low poly, geometric, faceted, clean edges",
    chibi:      ", chibi style, cute, big eyes, small body, adorable",
    comic:      ", comic book style, halftone, bold ink outlines, dynamic",
  };

  const negativeMap: Record<string, string> = {
    realistic:  "cartoon, drawing, anime, unrealistic",
    anime:      "realistic, photo, 3d render",
    cartoon:    "realistic, photo, anime",
    pixel:      "photorealistic, 3d, blurry, anti-aliased",
    lowpoly:    "photorealistic, detailed, complex",
    chibi:      "realistic, adult proportions, detailed",
    comic:      "realistic, photo, 3d",
  };

  const fullPrompt = `game character, full body, white background, ${prompt}${styleSuffix[style] || ""}`;
  const negative   = negativeMap[style] || "blurry, text, watermark";
  const usedSeed   = seed || Math.floor(Math.random() * 999999);

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}`
    + `?width=${width}&height=${height}&seed=${usedSeed}&nologo=true&negative=${encodeURIComponent(negative)}&model=flux`;

  res.json({ url, seed: usedSeed, prompt: fullPrompt });
});

/* ─── AI Edit: regenerate with modification instructions ── */
router.post("/:id/ai-edit", requireAuth, async (req, res) => {
  const { userId } = req.auth!;
  const { modification, style } = req.body;

  const character = await db.query.charactersTable.findFirst({
    where: and(eq(charactersTable.id, req.params.id), eq(charactersTable.userId, userId)),
  });
  if (!character) { res.status(404).json({ error: "not_found" }); return; }

  const newPrompt = `${character.prompt}. Modification: ${modification}`;
  const styleSuffix: Record<string, string> = {
    realistic: ", photorealistic, detailed",
    anime:     ", anime style, cel shading",
    cartoon:   ", cartoon style, bold outlines",
    pixel:     ", pixel art, 16-bit, retro sprite",
    lowpoly:   ", low poly, geometric",
    chibi:     ", chibi style, cute, big eyes",
    comic:     ", comic book style, bold outlines",
  };
  const usedStyle = style || character.gameStyle;
  const fullPrompt = `game character, full body, white background, ${newPrompt}${styleSuffix[usedStyle] || ""}`;
  const seed = Math.floor(Math.random() * 999999);
  const url  = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}`
    + `?width=512&height=512&seed=${seed}&nologo=true&model=flux`;

  res.json({ url, seed, newPrompt });
});

export default router;
