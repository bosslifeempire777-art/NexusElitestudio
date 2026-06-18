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
import { fetchUrlTool, bashTool, searchCodeTool, runTestsTool, type ToolDef } from "./agentTools.js";

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

  // ── inspect_dom ─────────────────────────────────────────────────────────
  const inspectDom: ToolDef = {
    name: "inspect_dom",
    description:
      "Maps the app's DOM structure without reading the full code: returns all element IDs, form IDs, " +
      "button text, input names, script block count, and critical platform flags (NEXUS_API, NEXUS_AUTH, DOMContentLoaded). " +
      "Use FIRST to get a quick orientation before read_app_code for large apps.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async () => {
      const code = state.code;
      if (!code) return { error: "No app code to inspect" };

      const extract = (re: RegExp): string[] => {
        const found: string[] = [];
        const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
        let m: RegExpExecArray | null;
        while ((m = r.exec(code)) !== null && found.length < 50) found.push(m[1] ?? m[0]);
        return found;
      };

      const ids      = extract(/\bid\s*=\s*["']([^"']+)["']/i);
      const forms    = extract(/<form[^>]*\bid\s*=\s*["']([^"']+)["']/i);
      const buttons  = extract(/<button[^>]*>([\s\S]*?)<\/button>/i)
        .map(b => b.replace(/<[^>]+>/g, "").trim().slice(0, 60));
      const inputs   = extract(/\bname\s*=\s*["']([^"']+)["']/i);
      const selects  = extract(/<select[^>]*\bid\s*=\s*["']([^"']+)["']/i);
      const eventHandlers = [...(code.match(/addEventListener\s*\(\s*["'](\w+)["']/g) ?? [])]
        .map(h => h.match(/["'](\w+)["']/)?.[1] ?? "")
        .filter(Boolean)
        .slice(0, 20);

      return {
        ids:            ids.slice(0, 40),
        forms:          forms.slice(0, 10),
        buttons:        buttons.slice(0, 25),
        inputNames:     inputs.slice(0, 20),
        selects:        selects.slice(0, 10),
        eventTypes:     [...new Set(eventHandlers)],
        scriptBlocks:   (code.match(/<script[^>]*>/gi) ?? []).length,
        styleBlocks:    (code.match(/<style[^>]*>/gi) ?? []).length,
        totalChars:     code.length,
        hasNexusApi:    /window\.NEXUS_API/i.test(code),
        hasNexusAuth:   /window\.NEXUS_AUTH/i.test(code),
        hasDomReady:    /DOMContentLoaded/i.test(code),
        hasInlineOnclick: /\sonclick\s*=/i.test(code),
      };
    },
  };

  // ── search_replace_in_code ──────────────────────────────────────────────
  const searchReplaceCode: ToolDef = {
    name: "search_replace_in_code",
    description:
      "Make a surgical change to the app code: find exact text and replace it. " +
      "PREFER THIS over rewriting the whole app for targeted fixes — it's faster and less error-prone. " +
      "The search is literal (not regex). Returns an error if the text is not found exactly as given. " +
      "Use for: fixing a specific function, updating a value, inserting code, changing a CSS rule, etc.",
    parameters: {
      type: "object",
      properties: {
        find:        { type: "string",  description: "Exact text to find (case-sensitive, must match verbatim)" },
        replace:     { type: "string",  description: "Replacement text" },
        replace_all: { type: "boolean", description: "Replace ALL occurrences (default: first occurrence only)" },
      },
      required: ["find", "replace"],
    },
    execute: async ({ find, replace, replace_all = false }: { find: string; replace: string; replace_all?: boolean }) => {
      const code = state.code;
      if (!code) return { ok: false, error: "No app code to modify" };

      const occurrences: number[] = [];
      let idx = code.indexOf(find);
      while (idx !== -1) { occurrences.push(idx); idx = code.indexOf(find, idx + 1); }

      if (occurrences.length === 0) {
        const hint = find.slice(0, 30);
        const closeIdx = code.toLowerCase().indexOf(hint.toLowerCase());
        return {
          ok:    false,
          error: `Text not found in app code: "${find.slice(0, 120)}"`,
          hint:  closeIdx !== -1
            ? `Similar text (case-insensitive) found near position ${closeIdx}. The app code may use different quotes, whitespace, or variable names.`
            : "No similar text found — try reading the relevant code section first with read_app_code.",
        };
      }

      const newCode = replace_all
        ? code.split(find).join(replace)
        : code.slice(0, occurrences[0]) + replace + code.slice(occurrences[0] + find.length);

      state.code = newCode;
      return {
        ok:               true,
        occurrencesFound: occurrences.length,
        replaced:         replace_all ? occurrences.length : 1,
        sizeBefore:       code.length,
        sizeAfter:        newCode.length,
        note:             occurrences.length > 1 && !replace_all
          ? `⚠️  ${occurrences.length} occurrences found but only the FIRST was replaced. Set replace_all=true to replace all.`
          : undefined,
      };
    },
  };

  // ── test_api_endpoints ──────────────────────────────────────────────────
  const testApiEndpoints: ToolDef = {
    name: "test_api_endpoints",
    description:
      "Tests the NEXUS_API backend end-to-end: creates a record, reads it back, updates it, then deletes it. " +
      "Use this AFTER any data/API-related change to verify the backend is working. " +
      "Also verifies the API URL is reachable and responding.",
    parameters: {
      type: "object",
      properties: {
        collection: {
          type: "string",
          description: "Collection to test (default: __smoke_test__). Use a real app collection to test actual data flows.",
        },
      },
      required: [],
    },
    execute: async ({ collection = "__smoke_test__" }: { collection?: string }) => {
      const results: Record<string, any> = { collection, nexusApiUrl };

      try {
        // CREATE
        const createRes = await fetch(`${nexusApiUrl}/${collection}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ _test: true, ts: Date.now(), label: "nexus_smoke_test" }),
          signal: AbortSignal.timeout(8_000),
        });
        const createData = await createRes.json().catch(() => ({})) as Record<string, any>;
        const recordId   = createData.id ?? createData._id ?? null;
        results.create   = { status: createRes.status, ok: createRes.ok, id: recordId };

        if (recordId) {
          // READ
          const readRes   = await fetch(`${nexusApiUrl}/${collection}/${recordId}`, { signal: AbortSignal.timeout(8_000) });
          results.read    = { status: readRes.status, ok: readRes.ok };

          // UPDATE
          const updateRes = await fetch(`${nexusApiUrl}/${collection}/${recordId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ _test: true, updated: true, ts: Date.now() }),
            signal: AbortSignal.timeout(8_000),
          });
          results.update  = { status: updateRes.status, ok: updateRes.ok };

          // DELETE
          const deleteRes = await fetch(`${nexusApiUrl}/${collection}/${recordId}`, {
            method: "DELETE", signal: AbortSignal.timeout(8_000),
          });
          results.delete  = { status: deleteRes.status, ok: deleteRes.ok || deleteRes.status === 404 };
        } else {
          results.note = "No record ID returned from create — cannot test read/update/delete";
        }
      } catch (e: any) {
        results.error = e.message;
      }

      const ops    = (["create", "read", "update", "delete"] as const).filter(k => k in results);
      const passed = ops.every(k => results[k]?.ok);
      results.summary = passed
        ? `✅ All ${ops.length} CRUD operations succeeded`
        : `❌ Some operations failed — check details above`;
      return results;
    },
  };

  // ── test_auth_flow ──────────────────────────────────────────────────────
  const testAuthFlow: ToolDef = {
    name: "test_auth_flow",
    description:
      "Tests the complete NEXUS_AUTH flow: registers a new test user, logs in, and verifies the JWT via /me. " +
      "Use this AFTER any login/auth change to confirm registration + login + session actually work end-to-end.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async () => {
      const results: Record<string, any> = { nexusAuthUrl };
      const ts       = Date.now();
      const email    = `smoke_${ts}@test.nexus`;
      const password = "SmokeTest123!";
      let   token    = "";

      try {
        // REGISTER
        const regRes  = await fetch(`${nexusAuthUrl}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: `smoke_${ts}`, email, password }),
          signal: AbortSignal.timeout(8_000),
        });
        const regData = await regRes.json().catch(() => ({})) as Record<string, any>;
        token = regData.token ?? "";
        results.register = { status: regRes.status, ok: [200, 201, 409].includes(regRes.status), hasToken: Boolean(token) };

        // LOGIN (always try, even if registered)
        const loginRes  = await fetch(`${nexusAuthUrl}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
          signal: AbortSignal.timeout(8_000),
        });
        const loginData = await loginRes.json().catch(() => ({})) as Record<string, any>;
        if (loginData.token) token = loginData.token as string;
        results.login = { status: loginRes.status, ok: loginRes.ok && Boolean(loginData.token), hasToken: Boolean(loginData.token) };

        // /me — verify JWT
        if (token) {
          const meRes  = await fetch(`${nexusAuthUrl}/me`, {
            headers: { Authorization: `Bearer ${token}` },
            signal:  AbortSignal.timeout(8_000),
          });
          const meData = await meRes.json().catch(() => ({})) as Record<string, any>;
          results.session = {
            status:  meRes.status,
            ok:      meRes.ok,
            hasUser: Boolean(meData.id ?? meData.userId ?? meData.email ?? meData.username),
          };
        } else {
          results.session = { ok: false, note: "No token obtained — skipped /me check" };
        }
      } catch (e: any) {
        results.error = e.message;
      }

      const passed = results.register?.ok && results.login?.ok && results.session?.ok;
      results.summary = passed
        ? "✅ Auth flow working — register, login, and /me all pass"
        : "❌ Auth flow has issues — see details above";
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
    inspectDom,
    analyzeAppCode,
    searchReplaceCode,
    smokeTestHtml,
    writeAppCode,
    testApiEndpoints,
    testAuthFlow,
    validateLiveApi,
    escalateToSwarm,
    searchCodeTool,
    runTestsTool,
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
    case "read_app_code":           return `[Concierge] 🔍 Reading app ${args.section ?? "full"} code...`;
    case "inspect_dom":             return `[Concierge] 🗺️  Mapping DOM structure...`;
    case "analyze_app_code":        return `[Concierge] 🔬 Running static analysis...`;
    case "search_replace_in_code":  return `[Concierge] ✂️  Replacing: "${(args.find ?? "").slice(0, 50)}"`;
    case "smoke_test_html":         return `[Concierge] 🧪 Smoke testing JS/HTML...`;
    case "write_app_code":          return `[Concierge] 💾 Saving updated code (${((args.html?.length ?? 0) / 1024).toFixed(1)} KB)...`;
    case "test_api_endpoints":      return `[Concierge] 🔁 Testing NEXUS_API CRUD (${args.collection ?? "__smoke_test__"})...`;
    case "test_auth_flow":          return `[Concierge] 🔐 Testing auth flow (register → login → /me)...`;
    case "validate_live_api":       return `[Concierge] 🌐 Validating live API endpoints...`;
    case "escalate_to_swarm":       return `[Concierge] 🚀 Escalating to full swarm: ${args.reason?.slice(0, 80) ?? ""}`;
    case "search_code":             return `[Concierge] 🔎 Searching workspace: "${(args.pattern ?? "").slice(0, 50)}"`;
    case "run_tests":               return `[Concierge] 🧪 Running tests${args.package ? ` (${args.package})` : ""}${args.filter ? ` — filter: ${args.filter}` : ""}...`;
    case "fetch_url":               return `[Concierge] 🌍 Fetching: ${(args.url ?? "").slice(0, 60)}`;
    case "bash_command":            return `[Concierge] 🖥️  Running: ${(args.command ?? "").slice(0, 60)}`;
    default:                        return `[Concierge] ⚙️  Tool: ${name}`;
  }
}

function toolResultLine(name: string, result: any): string {
  switch (name) {
    case "inspect_dom":
      if (result.error) return `[Concierge] ⚠️  DOM inspect error: ${result.error}`;
      return `[Concierge] 🗺️  DOM: ${result.ids?.length ?? 0} IDs · ${result.buttons?.length ?? 0} buttons · ${result.forms?.length ?? 0} forms · ${result.scriptBlocks ?? 0} scripts`;
    case "analyze_app_code":
      if (result.error) return `[Concierge] ⚠️  Analysis error: ${result.error}`;
      return result.healthy
        ? `[Concierge] ✅ Analysis: no issues found`
        : `[Concierge] ⚠️  Analysis: ${result.issueCount} issue(s), ${result.warningCount} warning(s)`;
    case "search_replace_in_code":
      return result.ok
        ? `[Concierge] ✂️  Replaced ${result.replaced}/${result.occurrencesFound} occurrence(s) — code ${result.sizeBefore < result.sizeAfter ? "grew" : "shrank"} by ${Math.abs((result.sizeAfter ?? 0) - (result.sizeBefore ?? 0))} chars`
        : `[Concierge] ❌ search_replace: ${result.error}`;
    case "smoke_test_html":
      return result.passed
        ? `[Concierge] ✅ Smoke test passed — ${result.summary ?? "all checks OK"}`
        : `[Concierge] ❌ Smoke test: ${result.errors?.[0] ?? "failed"}`;
    case "write_app_code":
      return result.ok
        ? `[Concierge] 💾 Code saved (${result.lines} lines)`
        : `[Concierge] ❌ Write failed: ${result.error}`;
    case "test_api_endpoints":
      return `[Concierge] 🔁 API test: ${result.summary ?? (result.error ? `❌ ${result.error}` : "done")}`;
    case "test_auth_flow":
      return `[Concierge] 🔐 Auth test: ${result.summary ?? (result.error ? `❌ ${result.error}` : "done")}`;
    case "validate_live_api":
      return `[Concierge] 🌐 NEXUS_API: ${result.nexusApi?.alive ? "✅ alive" : "❌ unreachable"} | NEXUS_AUTH: ${result.nexusAuth?.alive ? "✅ alive" : "❌ unreachable"}`;
    case "run_tests":
      if (result.failed && result.failed !== "0")
        return `[Concierge] ❌ Tests: ${result.failed} failed${result.passed ? `, ${result.passed} passed` : ""}`;
      if (result.passed)
        return `[Concierge] ✅ Tests: ${result.passed} passed`;
      return `[Concierge] 🧪 Tests complete (exit ${result.exitCode})`;
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

  const systemPrompt = `You are NEXUS CONCIERGE — an elite autonomous AI engineer with full tool access to a user's web app.
Your job: fulfill the user's request by reading, analyzing, modifying, AND verifying the app code yourself.
You MUST test your work — do not stop until your changes are confirmed working.

TOOLS (14 available — use the right tool for each job):
 1. read_app_code          → read current HTML/JS/CSS (section: full|scripts|html|styles)
 2. inspect_dom            → quick DOM map: all IDs, buttons, forms, inputs without reading full code
 3. analyze_app_code       → static analysis: broken auth, missing NEXUS_API, bad patterns
 4. search_replace_in_code → surgical find-and-replace: PREFER THIS for targeted fixes instead of full rewrites
 5. smoke_test_html        → validate JS syntax + critical patterns (pass html= to test BEFORE writing)
 6. write_app_code         → commit the final HTML (only after smoke_test_html passes)
 7. test_api_endpoints     → real CRUD test: create/read/update/delete against NEXUS_API
 8. test_auth_flow         → full auth test: register → login → /me → verify JWT
 9. validate_live_api      → check NEXUS_API + NEXUS_AUTH reachability
10. escalate_to_swarm      → LAST RESORT: full rebuild needed (NOT for targeted fixes or bugs)
11. search_code            → grep workspace files for patterns (useful for finding platform code)
12. run_tests              → run workspace test suite (vitest/jest — pass package= and filter=)
13. fetch_url              → read docs or external resources
14. bash_command           → advanced shell operations (node, curl, etc.)

WORKFLOW — follow this exactly, do not skip steps:
1. ORIENT: call inspect_dom for quick layout, then read_app_code (section='scripts' for JS bugs, 'full' for structural issues)
2. ANALYZE: call analyze_app_code to catch any broken patterns
3. FIX: use search_replace_in_code for targeted changes — only use write_app_code for large restructures
4. VALIDATE SYNTAX: run smoke_test_html on the proposed HTML (pass html= arg) — fix any errors before writing
5. SAVE: call write_app_code with the final clean HTML
6. VERIFY BACKEND: run test_api_endpoints + test_auth_flow to confirm data/auth flows work end-to-end
7. If any test fails → fix the issue and re-run the test
8. Only declare done when ALL checks pass

SURGICAL APPROACH (critical — follow this):
- For a bug fix: use search_replace_in_code to change only the broken lines
- For adding a feature: inject the new code at the right location, leave everything else intact
- For UI changes: update only the affected styles/elements
- NEVER rewrite the whole app unless the user explicitly asks for a full rebuild
- After every write_app_code always run at minimum: smoke_test_html + test_api_endpoints

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
