/**
 * AI Lab — pay-per-prompt test drive against multiple model providers.
 *
 * Users buy a pack of prompts, then run their own prompts against either
 * the auto-picked best model for their app type, or a side-by-side compare
 * across 3 models. When they pick a winner, we hand them a "graduate" link
 * to sign up directly with that provider (or OpenRouter for one-key access).
 */

import { db } from "@workspace/db";
import { aiLabPacksTable } from "@workspace/db/schema";
import { eq, and, sql, gt } from "drizzle-orm";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PROVIDER_FETCH_TIMEOUT_MS = 60_000;

/* ── Available prompt packs (one-time purchase) ─────────────────── */
export const PROMPT_PACKS = [
  { id: "starter",    prompts:  100, priceCents:   500, label: "Test Drive — 100 prompts",    perks: "Try a few features"   },
  { id: "explorer",   prompts:  500, priceCents:  1500, label: "Explorer — 500 prompts",      perks: "Most popular"          },
  { id: "pro",        prompts: 1500, priceCents:  4000, label: "Pro Lab — 1,500 prompts",     perks: "Best value per prompt" },
  { id: "powerhouse", prompts: 5000, priceCents:  9900, label: "Powerhouse — 5,000 prompts",  perks: "Heavy testing"         },
] as const;
export type PromptPackId = (typeof PROMPT_PACKS)[number]["id"];
export function getPack(id: string) {
  return PROMPT_PACKS.find(p => p.id === id);
}

/* ── Curated model roster per app type (real OpenRouter slugs) ─────
 *  We pick reasonable, broadly-available models. The single-mode picks
 *  the first ("primary"); compare-mode runs all three.
 */
type ModelSpec = { slug: string; label: string; provider: string };
const MODEL_ROSTER: Record<string, ModelSpec[]> = {
  saas: [
    { slug: "openai/gpt-4o",                       label: "GPT-4o",            provider: "openai"    },
    { slug: "anthropic/claude-3.5-sonnet",         label: "Claude 3.5 Sonnet", provider: "anthropic" },
    { slug: "google/gemini-2.5-flash",             label: "Gemini 2.5 Flash",  provider: "google"    },
  ],
  website: [
    { slug: "google/gemini-2.0-flash-001",         label: "Gemini 2.0 Flash",  provider: "google"    },
    { slug: "openai/gpt-4o-mini",                  label: "GPT-4o mini",       provider: "openai"    },
    { slug: "meta-llama/llama-3.3-70b-instruct",   label: "Llama 3.3 70B",     provider: "meta"      },
  ],
  ai_tool: [
    { slug: "anthropic/claude-3.5-sonnet",         label: "Claude 3.5 Sonnet", provider: "anthropic" },
    { slug: "openai/gpt-4o",                       label: "GPT-4o",            provider: "openai"    },
    { slug: "mistralai/mistral-large",             label: "Mistral Large",     provider: "mistral"   },
  ],
  mobile_app: [
    { slug: "anthropic/claude-3.5-sonnet",         label: "Claude 3.5 Sonnet", provider: "anthropic" },
    { slug: "openai/gpt-4o",                       label: "GPT-4o",            provider: "openai"    },
    { slug: "google/gemini-2.5-flash",             label: "Gemini 2.5 Flash",  provider: "google"    },
  ],
  automation: [
    { slug: "openai/gpt-4o-mini",                  label: "GPT-4o mini",       provider: "openai"    },
    { slug: "google/gemini-2.0-flash-001",         label: "Gemini 2.0 Flash",  provider: "google"    },
    { slug: "mistralai/mistral-small",             label: "Mistral Small",     provider: "mistral"   },
  ],
  game: [
    { slug: "deepseek/deepseek-chat",              label: "DeepSeek Chat",     provider: "deepseek"  },
    { slug: "meta-llama/llama-3.3-70b-instruct",   label: "Llama 3.3 70B",     provider: "meta"      },
    { slug: "google/gemini-2.0-flash-001",         label: "Gemini 2.0 Flash",  provider: "google"    },
  ],
};
const FALLBACK_ROSTER = MODEL_ROSTER.saas;

export function getModelsForAppType(appType: string | null | undefined): ModelSpec[] {
  if (!appType) return FALLBACK_ROSTER;
  return MODEL_ROSTER[appType] || FALLBACK_ROSTER;
}

/* ── Provider sign-up / "graduate" links ───────────────────────── */
export const PROVIDER_LINKS: Record<string, { name: string; signupUrl: string; note: string; affiliate: boolean }> = {
  openai:    { name: "OpenAI",    signupUrl: "https://platform.openai.com/signup",       note: "Direct API access at standard rates.",                     affiliate: false },
  anthropic: { name: "Anthropic", signupUrl: "https://console.anthropic.com/",           note: "Direct API access at standard rates.",                     affiliate: false },
  google:    { name: "Google AI", signupUrl: "https://aistudio.google.com/",             note: "Free tier available; direct API access.",                  affiliate: false },
  mistral:   { name: "Mistral",   signupUrl: "https://console.mistral.ai/",              note: "Direct API access at standard rates.",                     affiliate: false },
  deepseek:  { name: "DeepSeek",  signupUrl: "https://platform.deepseek.com/",           note: "Very low-cost direct API access.",                         affiliate: false },
  meta:      { name: "Llama (via Together AI)", signupUrl: "https://api.together.xyz/", note: "Llama models hosted by Together AI — direct API access.",  affiliate: false },
  // Aggregator: one key for ALL of these models. We earn margin via OpenRouter.
  openrouter:{ name: "OpenRouter (all models, one key)", signupUrl: "https://openrouter.ai/", note: "Use every provider above with a single API key — recommended.", affiliate: true },
};

/* ── Balance helpers ────────────────────────────────────────────── */
export async function getRemainingPrompts(userId: string): Promise<number> {
  const rows = await db
    .select({ remaining: aiLabPacksTable.promptsRemaining })
    .from(aiLabPacksTable)
    .where(and(eq(aiLabPacksTable.userId, userId), eq(aiLabPacksTable.status, "active")));
  return rows.reduce((sum, r) => sum + (r.remaining || 0), 0);
}

/**
 * Atomically deduct `count` prompts from the oldest active packs first.
 * Returns true if deduction succeeded, false if balance was insufficient.
 * Uses SKIP LOCKED row-level locks to prevent double-spend under concurrent runs.
 */
export async function consumePrompts(userId: string, count: number): Promise<boolean> {
  if (count <= 0) return true;
  return await db.transaction(async (tx) => {
    const packs = await tx.execute(sql`
      SELECT id, prompts_remaining
        FROM ai_lab_packs
       WHERE user_id = ${userId}
         AND status  = 'active'
         AND prompts_remaining > 0
       ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
    `);
    const rows = (packs as any).rows as Array<{ id: string; prompts_remaining: number }>;
    let need = count;
    const updates: Array<{ id: string; newRemaining: number }> = [];
    for (const row of rows) {
      if (need <= 0) break;
      const take = Math.min(need, row.prompts_remaining);
      updates.push({ id: row.id, newRemaining: row.prompts_remaining - take });
      need -= take;
    }
    if (need > 0) return false; // insufficient balance
    for (const u of updates) {
      await tx
        .update(aiLabPacksTable)
        .set({
          promptsRemaining: u.newRemaining,
          status: u.newRemaining === 0 ? "exhausted" : "active",
        })
        .where(eq(aiLabPacksTable.id, u.id));
    }
    return true;
  });
}

/* ── Run prompts against OpenRouter ────────────────────────────── */
export type ModelResult = {
  model: string;
  label: string;
  provider: string;
  ok: boolean;
  content: string;
  error?: string;
  durationMs: number;
  tokensIn?: number;
  tokensOut?: number;
};

async function callOpenRouter(model: string, prompt: string): Promise<{ ok: boolean; content: string; error?: string; tokensIn?: number; tokensOut?: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, content: "", error: "OPENROUTER_API_KEY not configured on server" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer":  "https://nexuselitestudio.com",
        "X-Title":       "NexusElite AI Lab",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 800,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, content: "", error: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }
    const data: any = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    return {
      ok: true,
      content,
      tokensIn:  data.usage?.prompt_tokens     ?? undefined,
      tokensOut: data.usage?.completion_tokens ?? undefined,
    };
  } catch (err: any) {
    if (err?.name === "AbortError") return { ok: false, content: "", error: `timeout after ${PROVIDER_FETCH_TIMEOUT_MS / 1000}s` };
    return { ok: false, content: "", error: err?.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function runModels(models: ModelSpec[], prompt: string): Promise<ModelResult[]> {
  const results = await Promise.all(models.map(async (m) => {
    const t0 = Date.now();
    const r  = await callOpenRouter(m.slug, prompt);
    return {
      model:    m.slug,
      label:    m.label,
      provider: m.provider,
      ok:       r.ok,
      content:  r.content,
      error:    r.error,
      durationMs: Date.now() - t0,
      tokensIn:  r.tokensIn,
      tokensOut: r.tokensOut,
    } as ModelResult;
  }));
  return results;
}
