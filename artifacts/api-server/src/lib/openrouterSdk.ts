import { OpenRouter } from "@openrouter/sdk";
import { SDKHooks } from "@openrouter/sdk/hooks/hooks.js";
import { createOpenRouterDevtools } from "@openrouter/devtools";
import {
  callModel,
  tool       as _agentTool,
  serverTool as _agentServerTool,
  stepCountIs,
  maxCost,
  maxTokensUsed,
  hasToolCall as stopOnToolCall,
} from "@openrouter/agent";
import type { Tool as AgentTool, StopWhen, ParsedToolCall, TurnContext, ConversationState } from "@openrouter/agent";

const OR_BASE = "https://openrouter.ai/api/v1";

function orHeaders(): Record<string, string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  return {
    Authorization:  `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer":  "https://nexuselitestudio.com",
    "X-Title":       "NexusElite AI Studio",
  };
}

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

// ─────────────────────────────────────────────────────────────
// MODELS LIST — for command portal model pickers
// ─────────────────────────────────────────────────────────────

export interface OpenRouterModel {
  id:             string;
  name:           string;
  context_length: number;
  pricing: {
    prompt:     string;  // USD per token as string
    completion: string;
  };
}

let _modelsCache: { ts: number; data: OpenRouterModel[] } | null = null;
const MODELS_CACHE_MS = 5 * 60_000; // 5 minutes

export async function listModels(): Promise<OpenRouterModel[]> {
  if (_modelsCache && Date.now() - _modelsCache.ts < MODELS_CACHE_MS) {
    return _modelsCache.data;
  }
  const res  = await fetch(`${OR_BASE}/models`, { headers: orHeaders() });
  if (!res.ok) throw new Error(`OpenRouter /models: HTTP ${res.status}`);
  const json = await res.json() as any;
  const data = (json.data ?? []).map((m: any) => ({
    id:             String(m.id),
    name:           String(m.name ?? m.id),
    context_length: Number(m.context_length ?? 0),
    pricing: {
      prompt:     String(m.pricing?.prompt     ?? "0"),
      completion: String(m.pricing?.completion ?? "0"),
    },
  }));
  _modelsCache = { ts: Date.now(), data };
  return data;
}

// ─────────────────────────────────────────────────────────────
// CREDITS — API key usage & limits
// ─────────────────────────────────────────────────────────────

export async function getCredits(): Promise<{
  label:       string;
  creditLimit: number | null;
  usedCredits: number;
  remaining:   number | null;
  isFreeTier:  boolean;
}> {
  const res  = await fetch(`${OR_BASE}/auth/key`, { headers: orHeaders() });
  if (!res.ok) throw new Error(`OpenRouter /auth/key: HTTP ${res.status}`);
  const json = await res.json() as any;
  const d    = json.data ?? {};
  const creditLimit  = typeof d.limit === "number" ? d.limit : null;
  const usedCredits  = typeof d.usage === "number" ? d.usage : 0;
  return {
    label:       String(d.label ?? "API Key"),
    creditLimit,
    usedCredits,
    remaining:   creditLimit !== null ? creditLimit - usedCredits : null,
    isFreeTier:  Boolean(d.is_free_tier),
  };
}

// ─────────────────────────────────────────────────────────────
// STREAMING CHAT — yields text deltas via SSE
// Use for real-time output; avoids SDK's AbortSignal.timeout quirks
// ─────────────────────────────────────────────────────────────

export async function* chatStreamViaSdk(
  body:  Record<string, any>,
  opts?: { timeoutMs?: number },
): AsyncGenerator<string> {
  const timeoutMs  = opts?.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${OR_BASE}/chat/completions`, {
      method:  "POST",
      headers: orHeaders(),
      body:    JSON.stringify({ ...body, stream: true }),
      signal:  controller.signal,
    });

    if (!res.ok) throw new Error(`OpenRouter stream: HTTP ${res.status}`);
    if (!res.body) throw new Error("No response body for streaming");

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const chunk = line.slice(6).trim();
        if (chunk === "[DONE]") return;
        try {
          const parsed = JSON.parse(chunk);
          const delta  = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta as string;
        } catch { /* skip malformed SSE frames */ }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────
// AGENT — multi-turn loops & tool orchestration (@openrouter/agent)
// ─────────────────────────────────────────────────────────────

/**
 * Re-exports from @openrouter/agent for defining tools in command-center routes.
 *
 * `agentTool`        — define a client-side tool with a Zod input schema
 * `agentServerTool`  — define a server-executed tool (runs inside the agent loop)
 * `stepCountIs`      — stop after N turns
 * `maxCost`          — stop after spending $N in API cost
 * `maxTokensUsed`    — stop after N total tokens consumed
 * `stopOnToolCall`   — stop as soon as a specific tool is invoked
 */
export {
  _agentTool       as agentTool,
  _agentServerTool as agentServerTool,
  stepCountIs,
  maxCost,
  maxTokensUsed,
  stopOnToolCall,
};
export type { AgentTool, StopWhen, ParsedToolCall, TurnContext, ConversationState };

/**
 * Run a multi-turn agent loop with automatic tool orchestration.
 *
 * The loop calls the model, executes every tool call it returns, feeds
 * results back, and repeats until either:
 *  - the model produces a turn with no tool calls, OR
 *  - a `stopWhen` condition fires (stepCountIs / maxCost / etc.)
 *
 * @example
 * ```ts
 * const { text, toolCallCount } = await callModelWithTools({
 *   model:      "openai/gpt-4o",
 *   input:      "Summarise the last 10 builds for project 42",
 *   tools:      [fetchBuildsTool, summariseTool],
 *   stopWhen:   stepCountIs(5),
 *   systemPrompt: "You are a build-status assistant.",
 * });
 * ```
 */
export async function callModelWithTools(opts: {
  model:         string;
  input:         string | Array<{ role: string; content: string }>;
  tools?:        readonly AgentTool[];
  stopWhen?:     StopWhen;
  systemPrompt?: string;
  maxTokens?:    number;
  temperature?:  number;
}): Promise<{
  text:          string;
  inputTokens:   number;
  outputTokens:  number;
  toolCallCount: number;
}> {
  const client = getOpenRouterClient();

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: "developer", content: opts.systemPrompt });
  if (typeof opts.input === "string") {
    messages.push({ role: "user", content: opts.input });
  } else {
    messages.push(...opts.input);
  }

  const result = callModel(client as any, {
    model:  opts.model,
    input:  messages as any,
    tools:  (opts.tools ?? []) as any,
    ...(opts.stopWhen ? { stopWhen: opts.stopWhen } : {}),
    params: {
      ...(opts.maxTokens    !== undefined ? { max_tokens:  opts.maxTokens }  : {}),
      ...(opts.temperature  !== undefined ? { temperature: opts.temperature } : {}),
    },
  });

  // All three consume the same underlying ReusableReadableStream — safe to call concurrently
  const [text, response, toolCalls] = await Promise.all([
    result.getText(),
    result.getResponse(),
    result.getToolCalls(),
  ]);

  return {
    text,
    inputTokens:   (response as any)?.usage?.inputTokens  ?? 0,
    outputTokens:  (response as any)?.usage?.outputTokens ?? 0,
    toolCallCount: toolCalls.length,
  };
}

/**
 * Streaming variant of `callModelWithTools`.
 * Yields text deltas in real-time while tools still execute automatically between turns.
 *
 * @example
 * ```ts
 * for await (const delta of streamAgentText({ model, input, tools })) {
 *   res.write(delta);
 * }
 * res.end();
 * ```
 */
export async function* streamAgentText(opts: {
  model:         string;
  input:         string | Array<{ role: string; content: string }>;
  tools?:        readonly AgentTool[];
  stopWhen?:     StopWhen;
  systemPrompt?: string;
  maxTokens?:    number;
  temperature?:  number;
}): AsyncGenerator<string> {
  const client = getOpenRouterClient();

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: "developer", content: opts.systemPrompt });
  if (typeof opts.input === "string") {
    messages.push({ role: "user", content: opts.input });
  } else {
    messages.push(...opts.input);
  }

  const result = callModel(client as any, {
    model:  opts.model,
    input:  messages as any,
    tools:  (opts.tools ?? []) as any,
    ...(opts.stopWhen ? { stopWhen: opts.stopWhen } : {}),
    params: {
      ...(opts.maxTokens    !== undefined ? { max_tokens:  opts.maxTokens }  : {}),
      ...(opts.temperature  !== undefined ? { temperature: opts.temperature } : {}),
    },
  });

  for await (const delta of result.getTextStream()) {
    yield delta;
  }
}
