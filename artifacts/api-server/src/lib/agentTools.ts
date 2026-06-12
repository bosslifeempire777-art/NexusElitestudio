/**
 * AGENT TOOLS — server-executed tools + agentic loop
 *
 * Implements a full OpenAI-compatible function-calling loop using the
 * same axios → OpenRouter approach as callLLM, so there's zero dependency
 * on a specific zod version or the @openrouter/agent SDK internals.
 *
 * Usage:
 *   import { runAgentWithTools, ALL_AGENT_TOOLS } from "./agentTools.js";
 *   const result = await runAgentWithTools({ model, systemPrompt, task, tools: ALL_AGENT_TOOLS });
 */

import axios from "axios";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

const WORKSPACE       = "/home/runner/workspace";
const OPENROUTER_URL  = "https://openrouter.ai/api/v1/chat/completions";
const MAX_OUTPUT_BYTES = 200_000;
const EXEC_TIMEOUT_MS  = 60_000;
const MAX_STEPS        = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Type definitions
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolDef {
  name:        string;
  description: string;
  parameters:  Record<string, any>; // JSON Schema object
  execute:     (args: any) => Promise<any>;
}

export interface AgentRunResult {
  text:          string;
  toolCallCount: number;
  inputTokens:   number;
  outputTokens:  number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell helper
// ─────────────────────────────────────────────────────────────────────────────

const BLOCK_PATTERNS = [
  /\brm\s+-rf\s+(\/|\$HOME|~)(\s|$)/,
  /\bmkfs\b/,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,
  /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/,
  /\bchmod\s+-R\s+777\s+\//,
  /\bdd\s+if=.*of=\/dev\//,
];

function isBlocked(cmd: string): boolean {
  return BLOCK_PATTERNS.some(re => re.test(cmd));
}

async function runShell(
  command: string,
  cwd = WORKSPACE,
): Promise<{ stdout: string; stderr: string; exitCode: string; truncated: boolean }> {
  return new Promise(resolve => {
    const outBufs: Buffer[] = [];
    const errBufs: Buffer[] = [];
    let totalBytes = 0;
    let truncated  = false;

    const child = spawn("bash", ["-lc", command], {
      cwd,
      env: { ...process.env, PAGER: "cat", GIT_PAGER: "cat", CI: "1", FORCE_COLOR: "0", TERM: "dumb" },
    });

    const kill = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, EXEC_TIMEOUT_MS);

    const onData = (bufs: Buffer[]) => (chunk: Buffer) => {
      if (totalBytes >= MAX_OUTPUT_BYTES) { truncated = true; return; }
      bufs.push(chunk);
      totalBytes += chunk.length;
    };

    child.stdout.on("data", onData(outBufs));
    child.stderr.on("data", onData(errBufs));

    child.on("close", (code, signal) => {
      clearTimeout(kill);
      resolve({
        stdout:   Buffer.concat(outBufs).toString("utf8"),
        stderr:   Buffer.concat(errBufs).toString("utf8"),
        exitCode: signal ? `signal:${signal}` : String(code ?? ""),
        truncated,
      });
    });
    child.on("error", err => {
      clearTimeout(kill);
      resolve({ stdout: "", stderr: err.message, exitCode: "spawn_error", truncated: false });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

export const bashTool: ToolDef = {
  name: "bash_command",
  description:
    "Run a bash command in the workspace. Use for: npm test, vitest, jest, node --check, " +
    "syntax validation, running scripts, installing packages, checking logs, any shell operation. " +
    "cwd is relative to workspace root (e.g. 'artifacts/ai-studio').",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Bash command to run" },
      cwd:     { type: "string", description: "Working dir relative to workspace root (optional)" },
    },
    required: ["command"],
  },
  execute: async ({ command, cwd }: { command: string; cwd?: string }) => {
    if (isBlocked(command)) {
      return { error: "blocked_command", stdout: "", stderr: "Blocked for safety.", exitCode: "blocked", truncated: false };
    }
    const workDir = cwd ? path.join(WORKSPACE, cwd.replace(/^\/+/, "")) : WORKSPACE;
    return runShell(command, workDir);
  },
};

export const readFileTool: ToolDef = {
  name: "read_file",
  description: "Read a file from the workspace. Returns file contents (paginated if large).",
  parameters: {
    type: "object",
    properties: {
      path:     { type: "string", description: "File path relative to workspace root" },
      offset:   { type: "integer", description: "1-indexed line to start reading from (default 1)", minimum: 1 },
      maxLines: { type: "integer", description: "Max lines to return (default 300, max 1000)", minimum: 1, maximum: 1000 },
    },
    required: ["path"],
  },
  execute: async ({ path: filePath, offset = 1, maxLines = 300 }: { path: string; offset?: number; maxLines?: number }) => {
    try {
      const absPath = path.join(WORKSPACE, filePath.replace(/^\/+/, ""));
      const content = await fs.readFile(absPath, "utf8");
      const lines   = content.split("\n");
      const start   = Math.max(0, offset - 1);
      const slice   = lines.slice(start, start + maxLines);
      return { content: slice.join("\n"), totalLines: lines.length, linesShown: slice.length, startLine: start + 1 };
    } catch (err: any) {
      return { error: err.message, content: "", totalLines: 0, linesShown: 0 };
    }
  },
};

export const writeFileTool: ToolDef = {
  name: "write_file",
  description: "Write (create or overwrite) a file in the workspace.",
  parameters: {
    type: "object",
    properties: {
      path:    { type: "string", description: "File path relative to workspace root" },
      content: { type: "string", description: "Full file content to write" },
    },
    required: ["path", "content"],
  },
  execute: async ({ path: filePath, content }: { path: string; content: string }) => {
    try {
      const absPath = path.join(WORKSPACE, filePath.replace(/^\/+/, ""));
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, content, "utf8");
      return { ok: true, bytesWritten: Buffer.byteLength(content, "utf8") };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  },
};

export const listDirectoryTool: ToolDef = {
  name: "list_directory",
  description: "List files and directories. Excludes node_modules, .git, dist by default.",
  parameters: {
    type: "object",
    properties: {
      path:      { type: "string", description: "Directory path relative to workspace root (default: root)" },
      recursive: { type: "boolean", description: "List recursively up to depth 4 (default false)" },
    },
    required: [],
  },
  execute: async ({ path: dirPath = ".", recursive = false }: { path?: string; recursive?: boolean }) => {
    const absDir = dirPath === "." ? WORKSPACE : path.join(WORKSPACE, dirPath.replace(/^\/+/, ""));
    if (recursive) {
      const r = await runShell(
        `find . -maxdepth 4 \\( -path '*/node_modules' -o -path '*/.git' -o -path '*/dist' -o -path '*/.next' \\) -prune -o -print | sort | head -300`,
        absDir,
      );
      return { entries: r.stdout.trim().split("\n").filter(Boolean) };
    }
    try {
      const entries = await fs.readdir(absDir, { withFileTypes: true });
      return { entries: entries.map(e => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" })) };
    } catch (err: any) {
      return { error: err.message, entries: [] };
    }
  },
};

export const searchCodeTool: ToolDef = {
  name: "search_code",
  description: "Search for patterns in the codebase using grep. Great for finding functions, imports, usages.",
  parameters: {
    type: "object",
    properties: {
      pattern:         { type: "string", description: "Regex or text pattern to search for" },
      directory:       { type: "string", description: "Directory to search (relative to workspace, default: whole workspace)" },
      filePattern:     { type: "string", description: "File glob filter e.g. '*.ts' or '*.tsx'" },
      caseInsensitive: { type: "boolean", description: "Case-insensitive search" },
      contextLines:    { type: "integer", description: "Lines of context around each match (default 2)", minimum: 0, maximum: 10 },
    },
    required: ["pattern"],
  },
  execute: async ({ pattern, directory, filePattern, caseInsensitive, contextLines = 2 }: {
    pattern: string; directory?: string; filePattern?: string; caseInsensitive?: boolean; contextLines?: number;
  }) => {
    const dir = directory ? path.join(WORKSPACE, directory.replace(/^\/+/, "")) : WORKSPACE;
    const flags = [
      "-rn",
      caseInsensitive ? "-i" : "",
      contextLines > 0 ? `-C ${contextLines}` : "",
      filePattern ? `--include=${JSON.stringify(filePattern)}` : "",
      "--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.next",
      "--max-count=20",
    ].filter(Boolean).join(" ");
    const cmd    = `grep ${flags} ${JSON.stringify(pattern)} . 2>/dev/null | head -400 || true`;
    const result = await runShell(cmd, dir);
    return { matches: result.stdout.slice(0, 50_000), matchCount: result.stdout.split("\n").filter(Boolean).length };
  },
};

export const fetchUrlTool: ToolDef = {
  name: "fetch_url",
  description: "Fetch content from a URL. Use for reading documentation, checking APIs, getting web content.",
  parameters: {
    type: "object",
    properties: {
      url:    { type: "string", description: "URL to fetch" },
      method: { type: "string", enum: ["GET", "POST"], description: "HTTP method (default GET)" },
      body:   { type: "string", description: "Request body for POST" },
    },
    required: ["url"],
  },
  execute: async ({ url, method = "GET", body }: { url: string; method?: string; body?: string }) => {
    try {
      const res  = await fetch(url, {
        method,
        body:    body ?? undefined,
        headers: { "User-Agent": "NexusElite-Agent/1.0" },
        signal:  AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      return { status: res.status, ok: res.ok, body: text.slice(0, 30_000), truncated: text.length > 30_000 };
    } catch (err: any) {
      return { error: err.message, status: 0, ok: false, body: "", truncated: false };
    }
  },
};

export const runTestsTool: ToolDef = {
  name: "run_tests",
  description:
    "Run the test suite for a workspace package. Detects vitest, jest, mocha automatically. " +
    "Pass 'package' as the artifact dir name (e.g. 'ai-studio', 'api-server'). " +
    "Pass 'filter' to run only tests matching a pattern.",
  parameters: {
    type: "object",
    properties: {
      package: { type: "string", description: "Package dir under artifacts/ (e.g. 'ai-studio'). Omit for workspace root." },
      filter:  { type: "string", description: "Test name/file filter pattern" },
      command: { type: "string", description: "Override test command entirely" },
    },
    required: [],
  },
  execute: async ({ package: pkg, filter, command }: { package?: string; filter?: string; command?: string }) => {
    let cwd = WORKSPACE;
    let cmd: string;

    if (command) {
      cmd = command;
      if (pkg) cwd = path.join(WORKSPACE, "artifacts", pkg);
    } else if (pkg) {
      cwd = path.join(WORKSPACE, "artifacts", pkg);
      const pkgJson  = await fs.readFile(path.join(cwd, "package.json"), "utf8").catch(() => "{}");
      const scripts  = JSON.parse(pkgJson).scripts ?? {};
      const filterArg = filter ? `-- -t ${JSON.stringify(filter)}` : "";
      cmd = scripts.test
        ? `npm test ${filterArg}`
        : `npx vitest run --reporter=verbose ${filter ? `-t ${JSON.stringify(filter)}` : ""}`;
    } else {
      cmd = `pnpm test ${filter ? `-- ${JSON.stringify(filter)}` : ""} 2>&1 || true`;
    }

    const result = await runShell(cmd + " 2>&1 || true", cwd);
    return {
      stdout:   result.stdout,
      stderr:   result.stderr,
      exitCode: result.exitCode,
      passed:   /(\d+) passed/i.exec(result.stdout)?.[1] ?? null,
      failed:   /(\d+) failed/i.exec(result.stdout)?.[1] ?? null,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool collections
// ─────────────────────────────────────────────────────────────────────────────

/** Full suite — custom agents get everything including bash + write */
export const ALL_AGENT_TOOLS: ToolDef[] = [
  bashTool,
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  searchCodeTool,
  fetchUrlTool,
  runTestsTool,
];

/** Read-only + network — swarm agents that should not modify workspace */
export const WORKSPACE_TOOLS: ToolDef[] = [
  readFileTool,
  listDirectoryTool,
  searchCodeTool,
  fetchUrlTool,
];

/** Validation tools — bash + read + search for the REPAIR phase */
export const REPAIR_TOOLS: ToolDef[] = [
  bashTool,
  readFileTool,
  searchCodeTool,
];

// ─────────────────────────────────────────────────────────────────────────────
// Agentic loop — full OpenAI function-calling protocol
// ─────────────────────────────────────────────────────────────────────────────

/** Convert our ToolDef array into the OpenAI tools format */
function toOpenAITools(tools: ToolDef[]) {
  return tools.map(t => ({
    type: "function",
    function: {
      name:        t.name,
      description: t.description,
      parameters:  t.parameters,
    },
  }));
}

/**
 * Run a multi-turn agent loop with automatic tool execution.
 * Uses OpenRouter's OpenAI-compatible API directly (no zod, no SDK internals).
 *
 * The loop calls the model, executes every tool call it requests, feeds
 * results back, and repeats until:
 *  - The model responds with no tool calls (done), OR
 *  - maxSteps is reached
 */
export async function runAgentWithTools(opts: {
  model:        string;
  systemPrompt: string;
  task:         string;
  tools:        ToolDef[];
  maxSteps?:    number;
  maxTokens?:   number;
  temperature?: number;
}): Promise<AgentRunResult> {
  const {
    model,
    systemPrompt,
    task,
    tools,
    maxSteps    = MAX_STEPS,
    maxTokens   = 8_000,
    temperature = 0.3,
  } = opts;

  const openAITools = toOpenAITools(tools);
  const toolMap     = new Map(tools.map(t => [t.name, t]));

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: task },
  ];

  let toolCallCount = 0;
  let inputTokens   = 0;
  let outputTokens  = 0;
  let finalText     = "";

  for (let step = 0; step < maxSteps; step++) {
    const body: Record<string, any> = {
      model,
      messages,
      max_tokens:  maxTokens,
      temperature,
      tools:       openAITools,
      tool_choice: "auto",
    };

    const res = await axios.post(OPENROUTER_URL, body, {
      headers: {
        Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer":  "https://nexuselitestudio.com",
        "X-Title":       "NexusElite-AgentTools",
      },
      timeout:        120_000,
      validateStatus: () => true,
    });

    if (res.status >= 400) {
      throw Object.assign(
        new Error(`OpenRouter HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`),
        { statusCode: res.status },
      );
    }

    const usage = res.data?.usage ?? {};
    inputTokens  += usage.prompt_tokens     ?? 0;
    outputTokens += usage.completion_tokens ?? 0;

    const choice  = res.data?.choices?.[0];
    const message = choice?.message ?? {};

    // Add the assistant's message to history
    messages.push(message);

    const calls: any[] = message.tool_calls ?? [];

    // No more tool calls → the model is done
    if (calls.length === 0) {
      finalText = message.content ?? "";
      break;
    }

    // Execute each tool call in parallel, then append results
    const toolResults = await Promise.allSettled(
      calls.map(async (call: any) => {
        const name = call.function?.name ?? "";
        const args = (() => {
          try { return JSON.parse(call.function?.arguments ?? "{}"); }
          catch { return {}; }
        })();
        const tool   = toolMap.get(name);
        const output = tool
          ? await tool.execute(args).catch((e: any) => ({ error: String(e?.message ?? e) }))
          : { error: `Unknown tool: ${name}` };
        return { call_id: call.id, output };
      }),
    );

    for (const r of toolResults) {
      const { call_id, output } = r.status === "fulfilled"
        ? r.value
        : { call_id: "", output: { error: String((r as any).reason) } };
      messages.push({
        role:         "tool",
        tool_call_id: call_id,
        content:      JSON.stringify(output).slice(0, 20_000),
      });
    }

    toolCallCount += calls.length;

    // If finish_reason is stop/end, break even if we had tool calls (safety)
    if (choice?.finish_reason === "stop" || choice?.finish_reason === "end_turn") break;
  }

  return { text: finalText, toolCallCount, inputTokens, outputTokens };
}
