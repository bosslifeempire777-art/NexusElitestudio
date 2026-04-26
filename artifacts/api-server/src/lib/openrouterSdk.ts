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
 *
 * Timeout handling — IMPORTANT:
 * We DO NOT pass `timeoutMs` to the SDK because internally it uses
 * `AbortSignal.timeout(ms)` whose rejection can fire AFTER the request
 * has already settled. That orphan rejection has no `.catch` and Node 24
 * promotes it to an unhandledRejection that kills the process — exactly
 * the cause of the production crash loop that surfaced as "lost
 * connection to server" in the agent UI.
 *
 * Instead we own one AbortController per call, race the SDK promise
 * against an explicit timer, and clear the timer on settle so no late
 * rejection escapes.
 */
export async function chatViaSdk(
  body: Record<string, any>,
  opts?: { timeoutMs?: number },
): Promise<any> {
  const sdk = getOpenRouterClient();
  const timeoutMs = opts?.timeoutMs ?? 0;

  if (timeoutMs <= 0) {
    return await (sdk.chat.send as any)({ chatRequest: { stream: false, ...body } });
  }

  // Real AbortController — passed into the SDK as `fetchOptions.signal`
  // so that on timeout we both reject the caller AND actually cancel the
  // upstream HTTPS request (freeing the socket so a stuck Opus call
  // doesn't pin a connection for minutes after we've moved on).
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let settled = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (settled) return;
      const err = new Error(`OpenRouter request timed out after ${Math.round(timeoutMs / 1000)}s`);
      (err as any).name = "AbortError";
      (err as any).code = "ETIMEDOUT";
      controller.abort(err); // cancels the in-flight fetch
      reject(err);
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
  });

  // Pre-attach a swallowing handler to the timeout promise. If the SDK
  // wins the race we never `await` the timeout promise, so without this
  // its eventual rejection (which we trigger via `controller.abort` on
  // future calls only — not here) would still be a no-op. Belt + braces.
  timeoutPromise.catch(() => {});

  try {
    const result = await Promise.race([
      (sdk.chat.send as any)(
        { chatRequest: { stream: false, ...body } },
        { fetchOptions: { signal: controller.signal } },
      ),
      timeoutPromise,
    ]);
    return result;
  } finally {
    settled = true;
    if (timer) clearTimeout(timer);
  }
}
