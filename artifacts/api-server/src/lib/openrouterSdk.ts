import { OpenRouter } from "@openrouter/sdk";
import { createOpenRouterDevtools } from "@openrouter/devtools";

let cached: OpenRouter | null = null;

/**
 * Singleton OpenRouter SDK client.
 *
 * In development we attach `@openrouter/devtools` as hooks so every request
 * is captured for local telemetry / replay. The devtools package itself
 * throws if NODE_ENV === "production", so we gate the hook attachment on
 * the same flag to keep production safe.
 */
export function getOpenRouterClient(): OpenRouter {
  if (cached) return cached;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const isDev = process.env.NODE_ENV !== "production";

  cached = new OpenRouter({
    apiKey,
    ...(isDev ? { hooks: createOpenRouterDevtools() } : {}),
  });

  if (isDev) {
    console.log("🔧 OpenRouter SDK initialized with devtools telemetry");
  }
  return cached;
}
