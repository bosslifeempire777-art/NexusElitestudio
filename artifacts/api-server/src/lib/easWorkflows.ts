const EAS_API = "https://api.expo.dev";

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
