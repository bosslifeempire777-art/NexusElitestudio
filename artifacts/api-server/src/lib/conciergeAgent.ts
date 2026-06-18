/**
 * NEXUS CONCIERGE AGENT
 *
 * A full tool-calling agent loop for post-build chat requests.
 * The concierge works autonomously on the generated app:
 *  - Reads and analyzes the full app code
 *  - Makes surgical targeted changes (not full rewrites)
 *  - Runs smoke tests after every write
 *  - Validates live NEXUS_API / NEXUS_AUTH endpoints
 *  - Escalates to the full Genesis Swarm only when truly needed
 *
 * Complexity routing:
 *  needsFullSwarm()  — fast keyword heuristic (no LLM call)
 *  escalate_to_swarm — in-loop tool the agent calls when it discovers complexity
 */

import axios from "axios";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchUrlTool, bashTool, type ToolDef } from "./agentTools.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Primary model — top of the confirmed-working coding tier */
const CONCIERGE_MODELS = [
  "qwen/qwen3.7-plus",
  "deepseek/deepseek-v4-flash",
  "qwen/qwen3-coder:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

const MAX_STEPS = 24;
const MAX_TOKENS = 12_000;

/** Keywords that mean the user wants a complete rebuild → use full swarm */
const SWARM_KEYWORDS =
  /\b(rebuild|rewrite|redesign|start[\s-]?over|from[\s-]?scratch|overhaul|complete[\s-]?redesign|full[\s-]?rebuild|redo\s+(?:the\s+)?(?:entire|whole|complete|full|all)|regenerate)\b/i;

export function needsFullSwarm(message: string): boolean {
  return SWARM_KEYWORDS.test(message);
}

// ── Mutable agent state (instance-scoped, never module-level) ─────────────────

interface AgentState {
  code:        string;
  needsSwarm:  boolean;
  swarmReason: string;
}

// ── Tool factory ──────────────────────────────────────────────────────────────

function createAppTools(
  state: AgentState,
  nexusApiUrl: string,
  nexusAuthUrl: string,
): ToolDef[] {
  // ── read_app_code ───────────────────────────────────────────────────────
  const readAppCode: ToolDef = {
    name: "read_app_code",
    description:
      "Read the current HTML/JS/CSS source of the app. " +
      "Always call this FIRST before making any changes so you know exactly what exists. " +
      "Use section='scripts' to get only the JavaScript, 'styles' for CSS, 'html' for structure, 'full' for everything.",
    parameters: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: ["full", "scripts", "html", "styles"],
          description: "Which part to return (default: full)",
        },
      },
      required: [],
    },
    execute: async ({ section = "full" }: { section?: string }) => {
      const code = state.code;
      if (!code) return { error: "No app code found — this app has not been built yet." };

      if (section === "scripts") {
        const blocks: string[] = [];
        const re = /<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(code)) !== null) blocks.push(m[0]);
        return { section: "scripts", content: blocks.join("\n\n---\n\n"), scriptCount: blocks.length, totalAppLength: code.length };
      }
      if (section === "styles") {
        const blocks: string[] = [];
        const re = /<style(?:\s[^>]*)?>[\s\S]*?<\/style>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(code)) !== null) blocks.push(m[0]);
        return { section: "styles", content: blocks.join("\n\n---\n\n"), totalAppLength: code.length };
      }
      if (section === "html") {
        const skeleton = code
          .replace(/<script[\s\S]*?<\/script>/gi, "<script>/* JS omitted */</script>")
          .replace(/<style[\s\S]*?<\/style>/gi, "<style>/* CSS omitted */</style>");
        return { section: "html_skeleton", content: skeleton, totalAppLength: code.length };
      }
      return { section: "full", content: code, totalLength: code.length, lines: code.split("\n").length };
    },
  };

  // ── write_app_code ──────────────────────────────────────────────────────
  const writeAppCode: ToolDef = {
    name: "write_app_code",
    description:
      "Save the updated HTML for the app. This is the FINAL save — the user's app will be updated with this content. " +
      "Only call AFTER smoke_test_html passes with no errors. " +
      "Must be a complete valid HTML document (<!DOCTYPE html>...). ",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "Complete updated HTML document for the app" },
      },
      required: ["html"],
    },
    execute: async ({ html }: { html: string }) => {
      const trimmed = html.trim();
      if (!trimmed.match(/^<!DOCTYPE\s+html|^<html/i)) {
        return { ok: false, error: "Must be a complete HTML document starting with <!DOCTYPE html> or <html>" };
      }
      if (trimmed.length < 500) {
        return { ok: false, error: `HTML is only ${trimmed.length} chars — too short to be a valid app. Did you write a partial snippet?` };
      }
      state.code = html;
      return { ok: true, bytesWritten: html.length, lines: html.split("\n").length };
    },
  };

  // ── analyze_app_code ────────────────────────────────────────────────────
  const analyzeAppCode: ToolDef = {
    name: "analyze_app_code",
    description:
      "Static analysis of the app — finds broken auth patterns, incorrect data storage, missing NEXUS_API usage, " +
      "inline event handlers, and other common issues. Call after read_app_code to understand what needs fixing.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async () => {
      const code = state.code;
      if (!code) return { error: "No app code to analyze" };

      const issues:   string[] = [];
      const warnings: string[] = [];
      const info:     Record<string, any> = {};

      // Auth pattern analysis
      const hasLoginForm   = /type\s*=\s*["']password["']/i.test(code);
      const hasNexusAuth   = /window\.NEXUS_AUTH/i.test(code);
      const hasLSPassword  = /localStorage\.(setItem|getItem)\s*\(\s*["'](password|pass|pwd|user_pass|userpass)/i.test(code);
      const hasBtoaAuth    = /btoa\s*\([\s\S]{0,40}password/i.test(code);
      const hasHardcodedU  = /(?:const|let|var)\s+users\s*=\s*\[|(?:const|let|var)\s+accounts\s*=\s*\[/i.test(code);
      const hasComparePw   = /if\s*\(.*password\s*===|===\s*password/i.test(code);

      if (hasLoginForm && !hasNexusAuth)  issues.push("LOGIN BROKEN: App has a login form but does NOT call window.NEXUS_AUTH — credentials are never checked against the real backend");
      if (hasLSPassword)                   issues.push("AUTH BROKEN: Passwords stored in localStorage — this is insecure and does not persist to the server");
      if (hasBtoaAuth)                     issues.push("AUTH BROKEN: btoa() used for auth — this is a fake pattern that fails on reload");
      if (hasHardcodedU)                   issues.push("AUTH BROKEN: Hardcoded users array — resets to empty on every page load, logins will fail");
      if (hasComparePw)                    issues.push("AUTH BROKEN: Direct password comparison in JS — passwords must be validated server-side via window.NEXUS_AUTH");

      // Data pattern analysis
      const hasNexusApi    = /window\.NEXUS_API/i.test(code);
      const hasLSData      = /localStorage\.(setItem|getItem)\s*\(\s*["'](?!_nexus_token)(items|tasks|data|records|products|orders|inventory|vehicles)/i.test(code);
      const hasInMemoryArr = /(?:const|let|var)\s+(?:db|items|tasks|records|products)\s*=\s*\[\]/i.test(code);
      const hasFetchRoot   = /fetch\s*\(\s*["']\/api\//i.test(code);

      if (hasLSData)      warnings.push("DATA: App stores app data in localStorage — data is wiped when user clears browser storage. Use window.NEXUS_API.");
      if (hasInMemoryArr) issues.push("DATA BROKEN: In-memory arrays used as database — all data is lost on every page reload");
      if (hasFetchRoot)   warnings.push("API: fetch('/api/...') detected — should use fetch(window.NEXUS_API+'/collection') so the correct backend URL is used");

      // Reassignment of platform globals (critical bug)
      if (/window\.NEXUS_API\s*=\s*["'`]/i.test(code)) issues.push("CRITICAL: Code overwrites window.NEXUS_API — it is pre-injected by the platform, never reassign it");
      if (/window\.NEXUS_AUTH\s*=\s*["'`]/i.test(code)) issues.push("CRITICAL: Code overwrites window.NEXUS_AUTH — it is pre-injected by the platform, never reassign it");

      // Event handler style
      const inlineOnclick = (code.match(/\s+onclick\s*=\s*["'][^"']{1,200}["']/gi) ?? []).length;
      if (inlineOnclick > 3) warnings.push(`STYLE: ${inlineOnclick} inline onclick="" attributes — these suppress errors. Convert to addEventListener.`);

      // DOM readiness
      const scriptsInHead  = /<head[^>]*>[\s\S]*?<script(?!\s+src)/i.test(code.slice(0, code.indexOf("</head>") + 10));
      const hasDOMReady    = /DOMContentLoaded|window\.onload\s*=/i.test(code);
      if (scriptsInHead) warnings.push("TIMING: Script tags in <head> — DOM elements won't exist yet. Move scripts to end of <body>.");
      if (!hasDOMReady && hasNexusApi) warnings.push("TIMING: No DOMContentLoaded wrapper found — direct DOM access before elements exist will cause null errors");

      // Size and structure info
      const scriptMatches: string[] = code.match(/<script[\s\S]*?<\/script>/gi) ?? [];
      const formCount  = (code.match(/<form[\s>]/gi) ?? []).length;
      const btnCount   = (code.match(/<button/gi) ?? []).length;
      const inputCount = (code.match(/<input/gi) ?? []).length;

      info.totalChars     = code.length;
      info.lines          = code.split("\n").length;
      info.scriptBlocks   = scriptMatches.length;
      info.totalScriptChars = scriptMatches.reduce((n, s) => n + s.length, 0);
      info.formCount      = formCount;
      info.buttonCount    = btnCount;
      info.inputCount     = inputCount;
      info.hasNexusApi    = hasNexusApi;
      info.hasNexusAuth   = hasNexusAuth;
      info.hasLoginForm   = hasLoginForm;

      const healthy = issues.length === 0;
      return { healthy, issueCount: issues.length, warningCount: warnings.length, issues, warnings, info };
    },
  };

  // ── smoke_test_html ─────────────────────────────────────────────────────
  const smokeTestHtml: ToolDef = {
    name: "smoke_test_html",
    description:
      "Validates the app's JavaScript syntax (via node --check) and checks for critical broken patterns. " +
      "Always call this AFTER write_app_code and fix any errors before finishing.",
    parameters: {
      type: "object",
      properties: {
        html: {
          type: "string",
          description: "HTML to test. If omitted, tests the current saved app code.",
        },
      },
      required: [],
    },
    execute: async ({ html }: { html?: string }) => {
      const code   = html ?? state.code;
      const errors: string[] = [];
      const warnings: string[] = [];

      // Extract inline script blocks (skip external src= scripts)
      const scriptBlocks: string[] = [];
      const re = /<script((?:\s+[^>]*)?)>([\s\S]*?)<\/script>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const attrs = m[1] ?? "";
        const body  = m[2] ?? "";
        if (/\bsrc\s*=/.test(attrs)) continue; // external script — skip
        if (body.trim()) scriptBlocks.push(body);
      }

      // JS syntax check via node --check
      if (scriptBlocks.length > 0) {
        const combined = scriptBlocks.join("\n\n/* --- next block --- */\n\n");
        const tmpFile  = join(tmpdir(), `nexus-smoke-${Date.now()}.cjs`);
        try {
          await fs.writeFile(tmpFile, combined, "utf8");
          const syntaxResult = await new Promise<{ ok: boolean; output: string }>(resolve => {
            const child = spawn("node", ["--check", tmpFile], { timeout: 10_000 });
            let out = "";
            child.stderr.on("data", (d: Buffer) => { out += d.toString(); });
            child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
            child.on("close", code => resolve({ ok: code === 0, output: out.slice(0, 3000) }));
            child.on("error", e => resolve({ ok: false, output: e.message }));
          });
          await fs.unlink(tmpFile).catch(() => {});
          if (!syntaxResult.ok) {
            errors.push(`JavaScript syntax error: ${syntaxResult.output}`);
          }
        } catch (e: any) {
          warnings.push(`Syntax check skipped: ${e.message}`);
        }
      }

      // Critical pattern checks
      if (/localStorage\.(setItem|getItem)\s*\(\s*["'](password|pass|pwd)/i.test(code))
        errors.push("CRITICAL: localStorage password storage — breaks auth");

      if (/(?:const|let|var)\s+users\s*=\s*\[[\s\S]*?password/i.test(code))
        errors.push("CRITICAL: Hardcoded users array with passwords — login breaks on reload");

      if (/window\.NEXUS_API\s*=\s*["'`]|window\.NEXUS_AUTH\s*=\s*["'`]/i.test(code))
        errors.push("CRITICAL: Code reassigns window.NEXUS_API or NEXUS_AUTH — these are pre-injected, never overwrite");

      if (/fetch\s*\(\s*["']\/api\//i.test(code))
        warnings.push("fetch('/api/...') found — use fetch(window.NEXUS_API+'/collection') instead");

      if (html && html.length > 100 && !html.trim().match(/^<!DOCTYPE|^<html/i))
        errors.push("HTML argument does not start with <!DOCTYPE html> or <html> — not a valid document");

      const passed = errors.length === 0;
      return {
        passed,
        errors,
        warnings,
        scriptBlocksChecked: scriptBlocks.length,
        summary: passed
          ? `✅ All checks passed (${scriptBlocks.length} script blocks validated)`
          : `❌ ${errors.length} error(s) found — fix before saving`,
      };
    },
  };

  // ── validate_live_api ───────────────────────────────────────────────────
  const validateLiveApi: ToolDef = {
    name: "validate_live_api",
    description:
      "Makes real HTTP calls to NEXUS_API and NEXUS_AUTH endpoints to verify the backend is responding for this project. " +
      "Use when the user reports buttons not working or login failing.",
    parameters: {
      type: "object",
      properties: {
        checkAuth: { type: "boolean", description: "Test NEXUS_AUTH endpoint (default true)" },
        checkData: { type: "boolean", description: "Test NEXUS_API endpoint (default true)" },
      },
      required: [],
    },
    execute: async ({ checkAuth = true, checkData = true }: { checkAuth?: boolean; checkData?: boolean }) => {
      const results: Record<string, any> = { nexusApiUrl, nexusAuthUrl };

      if (checkData) {
        try {
          // List a non-existent collection — 200/404 both mean backend is alive
          const r = await fetch(`${nexusApiUrl}/__healthcheck`, {
            signal: AbortSignal.timeout(6_000),
          });
          results.nexusApi = { status: r.status, alive: r.status < 500 };
        } catch (e: any) {
          results.nexusApi = { alive: false, error: e.message };
        }
      }

      if (checkAuth) {
        try {
          // Auto-register smoke_test account — 409=exists (ok), 201=created (ok), 400=validation (ok = endpoint alive)
          const r = await fetch(`${nexusAuthUrl}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: `smoke_${Date.now()}`, email: `smoke_${Date.now()}@test.com`, password: "SmokeTest123!" }),
            signal: AbortSignal.timeout(6_000),
          });
          const endpointAlive = r.status < 500;
          results.nexusAuth = { status: r.status, alive: endpointAlive, ok: [201, 409, 400].includes(r.status) };
        } catch (e: any) {
          results.nexusAuth = { alive: false, error: e.message };
        }
      }

      results.demoAccount = { email: "admin@demo.com", password: "NexusDemo123", note: "auto-created on each preview load" };
      return results;
    },
  };

  // ── escalate_to_swarm ───────────────────────────────────────────────────
  const escalateToSwarm: ToolDef = {
    name: "escalate_to_swarm",
    description:
      "Use ONLY when the task genuinely requires a complete rebuild (e.g. full redesign, switching frameworks, " +
      "adding 5+ major sections from scratch). For targeted fixes, bugs, and feature additions — handle it yourself.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why this task needs the full Genesis Swarm rebuild" },
      },
      required: ["reason"],
    },
    execute: async ({ reason }: { reason: string }) => {
      state.needsSwarm  = true;
      state.swarmReason = reason;
      return { acknowledged: true, action: "escalating_to_swarm", reason };
    },
  };

  return [
    readAppCode,
    writeAppCode,
    analyzeAppCode,
    smokeTestHtml,
    validateLiveApi,
    escalateToSwarm,
    fetchUrlTool,
    bashTool,
  ];
}

// ── Tool → OpenAI format ──────────────────────────────────────────────────────

function toOAITools(tools: ToolDef[]) {
  return tools.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

// ── Friendly log lines for each tool ─────────────────────────────────────────

function toolLogLine(name: string, args: any): string {
  switch (name) {
    case "read_app_code":      return `[Concierge] 🔍 Reading app ${args.section ?? "full"} code...`;
    case "write_app_code":     return `[Concierge] 💾 Saving updated code (${((args.html?.length ?? 0) / 1024).toFixed(1)} KB)...`;
    case "analyze_app_code":   return `[Concierge] 🔬 Running static analysis...`;
    case "smoke_test_html":    return `[Concierge] 🧪 Running smoke tests...`;
    case "validate_live_api":  return `[Concierge] 🌐 Validating live API endpoints...`;
    case "escalate_to_swarm":  return `[Concierge] 🚀 Escalating to full swarm: ${args.reason?.slice(0, 80) ?? ""}`;
    case "fetch_url":          return `[Concierge] 🌍 Fetching: ${(args.url ?? "").slice(0, 60)}`;
    case "bash_command":       return `[Concierge] 🖥️  Running: ${(args.command ?? "").slice(0, 60)}`;
    default:                   return `[Concierge] ⚙️  Tool: ${name}`;
  }
}

function toolResultLine(name: string, result: any): string {
  switch (name) {
    case "analyze_app_code":
      if (result.error) return `[Concierge] ⚠️  Analysis error: ${result.error}`;
      return result.healthy
        ? `[Concierge] ✅ Analysis: no issues found`
        : `[Concierge] ⚠️  Analysis: ${result.issueCount} issue(s), ${result.warningCount} warning(s)`;
    case "smoke_test_html":
      return result.passed
        ? `[Concierge] ✅ Smoke test passed — ${result.summary ?? "all checks OK"}`
        : `[Concierge] ❌ Smoke test: ${result.errors?.[0] ?? "failed"}`;
    case "write_app_code":
      return result.ok
        ? `[Concierge] 💾 Code saved (${result.lines} lines)`
        : `[Concierge] ❌ Write failed: ${result.error}`;
    case "validate_live_api":
      return `[Concierge] 🌐 NEXUS_API: ${result.nexusApi?.alive ? "✅ alive" : "❌ unreachable"} | NEXUS_AUTH: ${result.nexusAuth?.alive ? "✅ alive" : "❌ unreachable"}`;
    default:
      return "";
  }
}

// ── Agent loop with SSE logging ───────────────────────────────────────────────

async function runAgentLoop(
  tools: ToolDef[],
  toolMap: Map<string, ToolDef>,
  messages: any[],
  emitLog: (msg: string) => void,
  state: AgentState,
  preferredModel?: string,
): Promise<{ text: string; toolCallCount: number; modelUsed: string; tokensIn: number; tokensOut: number }> {
  const oaiTools = toOAITools(tools);
  let finalText    = "";
  let modelIdx     = 0;
  let totalCalls   = 0;
  let totalIn      = 0;
  let totalOut     = 0;
  // Build model chain: preferred model first, then the standard fallbacks
  const modelChain = preferredModel
    ? [preferredModel, ...CONCIERGE_MODELS.filter(m => m !== preferredModel)]
    : CONCIERGE_MODELS;
  let activeModel  = modelChain[0]!;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (state.needsSwarm) break;

    const model = modelChain[modelIdx % modelChain.length]!;
    activeModel = model;

    let res;
    try {
      res = await axios.post(
        OPENROUTER_URL,
        { model, messages, max_tokens: MAX_TOKENS, temperature: 0.25, tools: oaiTools, tool_choice: "auto" },
        {
          headers: {
            Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer":  "https://nexuselitestudio.com",
            "X-Title":       "NexusElite-Concierge",
          },
          timeout:        180_000,
          validateStatus: () => true,
        },
      );
    } catch (networkErr: any) {
      emitLog(`[Concierge] ⚠️  Network error (step ${step}): ${String(networkErr.message).slice(0, 100)}`);
      break;
    }

    if (res.status >= 400) {
      modelIdx++;
      if (modelIdx >= modelChain.length) {
        emitLog(`[Concierge] ❌ All models failed (HTTP ${res.status})`);
        break;
      }
      emitLog(`[Concierge] ↩️  Retrying with ${modelChain[modelIdx]}...`);
      continue;
    }

    const choice  = res.data?.choices?.[0];
    const message = choice?.message ?? {};
    messages.push(message);

    // Accumulate token usage for billing
    totalIn  += res.data?.usage?.prompt_tokens     ?? 0;
    totalOut += res.data?.usage?.completion_tokens ?? 0;

    const calls: any[] = message.tool_calls ?? [];

    if (calls.length === 0) {
      finalText = message.content ?? "";
      break;
    }

    // Execute tool calls sequentially (order matters — write must follow smoke test)
    for (const call of calls) {
      const name = call.function?.name ?? "";
      const args = (() => {
        try { return JSON.parse(call.function?.arguments ?? "{}"); } catch { return {}; }
      })();

      const logLine = toolLogLine(name, args);
      if (logLine) emitLog(logLine);

      const tool   = toolMap.get(name);
      const output = tool
        ? await tool.execute(args).catch((e: any) => ({ error: String(e?.message ?? e) }))
        : { error: `Unknown tool: ${name}` };

      const resultLine = toolResultLine(name, output);
      if (resultLine) emitLog(resultLine);

      messages.push({
        role:         "tool",
        tool_call_id: call.id,
        content:      JSON.stringify(output).slice(0, 24_000),
      });

      totalCalls++;
      if (state.needsSwarm) break;
    }

    if (choice?.finish_reason === "stop" || choice?.finish_reason === "end_turn") break;
  }

  return { text: finalText, toolCallCount: totalCalls, modelUsed: activeModel, tokensIn: totalIn, tokensOut: totalOut };
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface ConciergeResult {
  code:          string;
  changed:       boolean;
  summary:       string;
  needsSwarm:    boolean;
  swarmReason:   string;
  modelUsed:     string;
  toolCallCount: number;
  tokensIn:      number;
  tokensOut:     number;
}

export async function runConciergeAgent(opts: {
  projectId:       string;
  projectName:     string;
  projectType:     string;
  currentCode:     string;
  userMessage:     string;
  userSecretNames: string[];
  nexusApiUrl:     string;
  nexusAuthUrl:    string;
  model?:          string;
  emitLog:         (msg: string) => void;
}): Promise<ConciergeResult> {
  const {
    projectId, projectName, projectType,
    currentCode, userMessage, userSecretNames,
    nexusApiUrl, nexusAuthUrl, emitLog,
    model: preferredModel,
  } = opts;

  const state: AgentState = { code: currentCode, needsSwarm: false, swarmReason: "" };
  const tools   = createAppTools(state, nexusApiUrl, nexusAuthUrl);
  const toolMap = new Map(tools.map(t => [t.name, t]));

  const secretsLine = userSecretNames.length > 0
    ? `User API keys in window.USER_SECRETS: ${userSecretNames.join(", ")}.`
    : "No user API keys configured yet.";

  const systemPrompt = `You are NEXUS CONCIERGE — an elite autonomous AI engineer with full access to a user's web app.
Your job: fulfill the user's request by reading, analyzing, modifying, and testing the app code yourself.

TOOLS (use in this order):
1. read_app_code      → always read first to understand the current state
2. analyze_app_code   → find issues relevant to the request
3. smoke_test_html    → validate JS syntax + patterns (run on candidate HTML before writing)
4. write_app_code     → commit the final fix (only after smoke test passes)
5. validate_live_api  → verify NEXUS_API / NEXUS_AUTH are responding (for API/auth issues)
6. escalate_to_swarm  → LAST RESORT: complete rebuild needed (not for targeted fixes)
7. fetch_url          → read documentation or external resources
8. bash_command       → advanced shell operations

WORKFLOW — follow exactly:
1. Read the app code (section='scripts' if it's a JS/auth issue, 'full' for structure)
2. Analyze to understand the problem
3. Plan your surgical change (what exactly to add/replace/remove)
4. Run smoke_test_html on your NEW version (pass html= argument with your proposed code)
5. If smoke test passes → call write_app_code with the final HTML
6. If smoke test fails → fix the issues and re-test
7. Only write_app_code when everything is clean

SURGICAL APPROACH — never rewrite the whole app unless explicitly requested:
- For a bug fix: change only the broken section
- For adding a feature: add the new code, leave the rest untouched
- For UI changes: update only the affected styles/elements
- Keep all existing functionality, styling, and NEXUS_API usage intact

PLATFORM FACTS (CRITICAL — violating these breaks the app):
- window.NEXUS_API    → pre-injected data backend (ALL persistent data goes through here)
- window.NEXUS_AUTH   → pre-injected auth backend (ALL login/register/session calls go here)
- NEVER reassign window.NEXUS_API or window.NEXUS_AUTH
- NEVER store app data in localStorage (except _nexus_token for auth JWT)
- NEVER use inline onclick="" — always addEventListener
- Put ALL <script> blocks at end of <body>
- Wrap ALL DOM-touching code in DOMContentLoaded

CORRECT AUTH PATTERNS (use exactly):
  Register: fetch(window.NEXUS_AUTH+'/register', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,email,password})}).then(r=>r.json()).then(d=>{if(d.token)localStorage.setItem('_nexus_token',d.token);})
  Login:    fetch(window.NEXUS_AUTH+'/login',    {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password})}).then(r=>r.json()).then(d=>{if(d.token)localStorage.setItem('_nexus_token',d.token);})
  Me:       fetch(window.NEXUS_AUTH+'/me', {headers:{Authorization:'Bearer '+localStorage.getItem('_nexus_token')}}).then(r=>r.ok?r.json():null)
  Logout:   localStorage.removeItem('_nexus_token')
  Demo auto-seed: fetch(window.NEXUS_AUTH+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',email:'admin@demo.com',password:'NexusDemo123'})}).catch(()=>{})

PROJECT:
- Name: ${projectName}
- Type: ${projectType}
- ${secretsLine}
- NEXUS_API:  ${nexusApiUrl}
- NEXUS_AUTH: ${nexusAuthUrl}

When done, briefly describe what you changed and confirm it's working.`;

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userMessage },
  ];

  const displayModel = preferredModel ?? CONCIERGE_MODELS[0];
  emitLog(`[Concierge] 🤖 NEXUS CONCIERGE online — model: ${displayModel} — analyzing "${projectName}"...`);

  const { text: summary, toolCallCount, modelUsed, tokensIn, tokensOut } =
    await runAgentLoop(tools, toolMap, messages, emitLog, state, preferredModel);

  const changed = state.code !== currentCode && state.code.length > 500;

  if (state.needsSwarm) {
    emitLog(`[Concierge] 🚀 Escalating to Genesis Swarm: ${state.swarmReason.slice(0, 80)}`);
  } else if (changed) {
    emitLog(`[Concierge] 🎉 Done — ${toolCallCount} tool call(s) · code updated · ready to preview`);
  } else {
    emitLog(`[Concierge] ✅ Analysis complete — ${toolCallCount} tool call(s) · no code changes needed`);
  }

  return {
    code:          state.code,
    changed,
    summary:       summary || (state.needsSwarm ? `Escalated to swarm: ${state.swarmReason}` : "Analysis complete"),
    needsSwarm:    state.needsSwarm,
    swarmReason:   state.swarmReason,
    modelUsed,
    toolCallCount,
    tokensIn,
    tokensOut,
  };
}
