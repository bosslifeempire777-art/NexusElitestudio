/**
 * GET /api/models
 * Returns all OpenRouter models available to the configured API key.
 * Results are cached for 5 minutes so we don't hammer the OpenRouter API.
 */
import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth.js";
import axios from "axios";

const router: IRouter = Router();

interface ModelEntry {
  id:             string;
  name:           string;
  context_length: number;
  pricing: {
    prompt:     string;
    completion: string;
  };
  supports_tools: boolean;
}

let _cache: { models: ModelEntry[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

router.get("/", requireAuth, async (_req, res) => {
  try {
    if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
      res.json({ models: _cache.models, cached: true });
      return;
    }

    const orRes = await axios.get("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer":  "https://nexuselitestudio.com",
        "X-Title":       "NexusElite-Studio",
      },
      timeout: 15_000,
      validateStatus: () => true,
    });

    if (orRes.status >= 400) {
      res.status(502).json({ error: "OpenRouter returned an error", status: orRes.status });
      return;
    }

    const raw: any[] = orRes.data?.data ?? [];

    const models: ModelEntry[] = raw
      .filter(m => (m.context_length ?? 0) >= 4096)
      .map(m => ({
        id:             m.id,
        name:           m.name ?? m.id,
        context_length: m.context_length ?? 0,
        pricing: {
          prompt:     m.pricing?.prompt     ?? "0",
          completion: m.pricing?.completion ?? "0",
        },
        supports_tools: !!(m.supported_parameters?.includes?.("tools") ||
                           m.top_provider?.is_moderated === false ||
                           m.id.includes("gpt") ||
                           m.id.includes("claude") ||
                           m.id.includes("gemini") ||
                           m.id.includes("qwen") ||
                           m.id.includes("deepseek") ||
                           m.id.includes("llama")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    _cache = { models, fetchedAt: Date.now() };
    res.json({ models, cached: false, total: models.length });
  } catch (err: any) {
    console.error("[models] fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch models", message: err.message });
  }
});

export default router;
