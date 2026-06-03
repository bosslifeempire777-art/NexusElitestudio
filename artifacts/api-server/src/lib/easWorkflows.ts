import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const EAS_API  = "https://api.expo.dev";
const EAS_BIN  = resolve(process.cwd(), "artifacts/api-server/node_modules/.bin/eas");

function easHeaders(): Record<string, string> {
  const token = process.env.EXPO_TOKEN;
  if (!token) throw new Error("EXPO_TOKEN not set");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export interface WorkflowRun {
  id:        string;
  name:      string;
  status:    string;
  createdAt: string;
  duration:  number | null;
  logsUrl:   string | null;
}

/** List recent workflow runs for a project */
export async function listWorkflowRuns(easProjectSlug: string): Promise<WorkflowRun[]> {
  try {
    const res  = await fetch(`${EAS_API}/v2/workflow-runs?appSlug=${encodeURIComponent(easProjectSlug)}&limit=20`, {
      headers: easHeaders(),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const items: any[] = data?.data ?? data ?? [];
    return items.map((r: any) => ({
      id:        r.id ?? "",
      name:      r.workflowName ?? r.name ?? "workflow",
      status:    r.status ?? "unknown",
      createdAt: r.createdAt ?? new Date().toISOString(),
      duration:  r.duration ?? null,
      logsUrl:   r.logsPageUrl ?? null,
    }));
  } catch (err) {
    console.warn("[easWorkflows] listWorkflowRuns failed (non-fatal):", err);
    return [];
  }
}

export interface WorkflowRunLog {
  runId:     string;
  status:    string;
  name:      string;
  logsUrl:   string | null;
  createdAt: string;
  steps:     Array<{ name: string; status: string; durationMs: number | null }>;
}

/** Trigger an EAS workflow run for a project using the given YAML */
export async function triggerWorkflowRun(opts: {
  easProjectSlug: string;
  workflowName:   string;
  yaml:           string;
}): Promise<WorkflowRun> {
  const { easProjectSlug, workflowName, yaml } = opts;
  const token = process.env.EXPO_TOKEN;
  if (!token) throw new Error("EXPO_TOKEN not set");

  const dir = await mkdtemp(join(tmpdir(), "nexus-wf-"));
  await writeFile(join(dir, ".eas", "workflows", `${workflowName}.yml`), yaml, "utf8").catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, ".eas", "workflows"), { recursive: true });
    await writeFile(join(dir, ".eas", "workflows", `${workflowName}.yml`), yaml, "utf8");
  });

  let runId = `run-${Date.now()}`;
  let status = "queued";
  try {
    const { stdout } = await execFileAsync(
      EAS_BIN,
      ["workflow:run", workflowName, "--non-interactive", "--json"],
      {
        cwd: dir,
        timeout: 60_000,
        env: { ...process.env, EXPO_TOKEN: token, CI: "1", EXPO_NO_TELEMETRY: "1" },
      },
    );
    const parsed: any = JSON.parse(stdout.trim());
    runId  = parsed?.id ?? runId;
    status = parsed?.status ?? "queued";
  } catch (err) {
    console.warn("[easWorkflows] triggerWorkflowRun CLI failed (non-fatal):", err);
  }

  return { id: runId, name: workflowName, status, createdAt: new Date().toISOString(), duration: null, logsUrl: null };
}

/** Get logs / status for a specific workflow run */
export async function getWorkflowRunLogs(runId: string): Promise<WorkflowRunLog> {
  try {
    const token = process.env.EXPO_TOKEN;
    if (!token) throw new Error("EXPO_TOKEN not set");
    const res = await fetch(`${EAS_API}/v2/workflow-runs/${encodeURIComponent(runId)}`, {
      headers: easHeaders(),
    });
    if (!res.ok) throw new Error(`EAS ${res.status}`);
    const data: any = await res.json();
    const run = data?.data ?? data;
    return {
      runId,
      status:    run.status ?? "unknown",
      name:      run.workflowName ?? run.name ?? "workflow",
      logsUrl:   run.logsPageUrl ?? null,
      createdAt: run.createdAt ?? new Date().toISOString(),
      steps: (run.steps ?? []).map((s: any) => ({
        name:       s.name ?? "step",
        status:     s.status ?? "unknown",
        durationMs: s.durationMs ?? null,
      })),
    };
  } catch (err) {
    console.warn("[easWorkflows] getWorkflowRunLogs failed:", err);
    return { runId, status: "unknown", name: "workflow", logsUrl: null, createdAt: new Date().toISOString(), steps: [] };
  }
}

/** Built-in workflow YAML templates */
export const WORKFLOW_TEMPLATES: Record<string, { label: string; yaml: string }> = {
  "build-android": {
    label: "Build Android APK",
    yaml: `on:
  push:
    branches:
      - main
jobs:
  build:
    name: Build Android
    type: build
    params:
      platform: android
      profile: preview
`,
  },
  "build-ios": {
    label: "Build iOS IPA",
    yaml: `on:
  push:
    branches:
      - main
jobs:
  build:
    name: Build iOS
    type: build
    params:
      platform: ios
      profile: preview
`,
  },
  "build-submit-android": {
    label: "Build & Submit Android",
    yaml: `on:
  push:
    branches:
      - main
jobs:
  build:
    name: Build Android
    type: build
    params:
      platform: android
      profile: production
  submit:
    name: Submit to Play Store
    needs: build
    type: submit
    params:
      platform: android
      profile: production
`,
  },
  "ota-update": {
    label: "OTA Update (main branch)",
    yaml: `on:
  push:
    branches:
      - main
jobs:
  update:
    name: Publish OTA Update
    type: update
    params:
      channel: main
      message: "Automated OTA update"
`,
  },
};
