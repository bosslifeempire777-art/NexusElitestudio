import { OpenRouter } from "@openrouter/sdk";
import { SDKHooks } from "@openrouter/sdk/hooks/hooks.js";
import { createOpenRouterDevtools } from "@openrouter/devtools";

let cached: OpenRouter | null = null;

/**
 * Singleton OpenRouter SDK client.
 *
 * In development we attach `@openrouter/devtools` so every request is
 * captured for local telemetry / replay (written to
 * `<api-server>/.devtools/openrouter-generations.json` by default).
 *
 * The SDK's runtime check is `opt.hooks instanceof SDKHooks`, so we have to
 * build a real SDKHooks instance and register the devtools' three callbacks
 * on it — passing the devtools object directly is silently ignored.
 *
 * Devtools throws if NODE_ENV === "production", so we gate it on the same
 * flag to keep production safe.
 */
export function getOpenRouterClient(): OpenRouter {
  if (cached) return cached;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const isDev = process.env.NODE_ENV !== "production";

  let hooks: SDKHooks | undefined;
  if (isDev) {
    const dt = createOpenRouterDevtools({
      storagePath:
        process.env.OPENROUTER_DEVTOOLS_STORAGE_PATH ??
        ".devtools/openrouter-generations.json",
      serverUrl:
        process.env.OPENROUTER_DEVTOOLS_SERVER_URL ??
        "http://localhost:4983/api/notify",
    });
    hooks = new SDKHooks();
    hooks.registerBeforeRequestHook({ beforeRequest: dt.beforeRequest });
    hooks.registerAfterSuccessHook({ afterSuccess: dt.afterSuccess });
    hooks.registerAfterErrorHook({   afterError:   dt.afterError   });
  }

  cached = new OpenRouter({
    apiKey,
    httpReferer: "https://nexuselitestudio.com",
    appTitle:    "NexusElite AI Studio",
    ...(hooks ? { hooks } : {}),
  } as any);

  if (isDev) {
    console.log(
      `🔧 OpenRouter SDK initialized with devtools telemetry → ${
        process.env.OPENROUTER_DEVTOOLS_STORAGE_PATH ??
        ".devtools/openrouter-generations.json"
      }`,
    );
  }
  return cached;
}

/**
 * Thin convenience wrapper: same call shape as the OpenRouter REST API
 * (`{model, messages, max_tokens, response_format, temperature, ...}`),
 * returns the OpenAI-compatible response (`{choices, usage, ...}`).
 *
 * Routes every request through the singleton SDK so devtools captures it.
 * Use this anywhere in the api-server instead of raw `fetch` to
 * `https://openrouter.ai/api/v1/chat/completions`.
 */
export async function chatViaSdk(
  body: Record<string, any>,
  opts?: { timeoutMs?: number },
): Promise<any> {
  const sdk = getOpenRouterClient();
  // The SDK exposes `sdk.chat.send({ chatRequest })` and returns the
  // upstream OpenAI-shaped JSON unchanged.
  return await (sdk.chat.send as any)(
    { chatRequest: { stream: false, ...body } },
    opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : undefined,
  );
}
