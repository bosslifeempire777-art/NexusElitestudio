import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const EXPO_OWNER = "Nexuselitestudio";
const EAS_API    = "https://api.expo.dev";
const EAS_BIN    = resolve(process.cwd(), "artifacts/api-server/node_modules/.bin/eas");

function easHeaders(): Record<string, string> {
  const token = process.env.EXPO_TOKEN;
  if (!token) throw new Error("EXPO_TOKEN not set");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function easGet(path: string): Promise<any> {
  const res  = await fetch(`${EAS_API}${path}`, { headers: easHeaders() });
  const text = await res.text();
  if (!res.ok) throw new Error(`EAS ${res.status} GET ${path}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export interface OtaUpdate {
  id:         string;
  branch:     string;
  message:    string;
  platform:   string;
  createdAt:  string;
  runtimeVersion: string;
}

export interface OtaChannel {
  id:         string;
  name:       string;
  branchName: string | null;
  createdAt:  string;
}

export interface OtaBranch {
  id:        string;
  name:      string;
  createdAt: string;
}

/** List recent OTA updates for a project slug (up to 20) */
export async function listOtaUpdates(easProjectSlug: string): Promise<OtaUpdate[]> {
  try {
    const data = await easGet(`/v2/updates?appId=${encodeURIComponent(EXPO_OWNER)}%2F${encodeURIComponent(easProjectSlug)}&limit=20`);
    const items: any[] = data?.data ?? data ?? [];
    return items.map((u: any) => ({
      id:             u.id ?? u.updateId ?? "",
      branch:         u.branchName ?? u.branch ?? "",
      message:        u.message ?? u.updateMessage ?? "",
      platform:       u.platform ?? "",
      createdAt:      u.createdAt ?? new Date().toISOString(),
      runtimeVersion: u.runtimeVersion ?? "",
    }));
  } catch (err) {
    console.warn("[easUpdate] listOtaUpdates failed (non-fatal):", err);
    return [];
  }
}

/** List EAS channels for a project slug */
export async function listChannels(easProjectSlug: string): Promise<OtaChannel[]> {
  try {
    const data = await easGet(`/v2/channels?appId=${encodeURIComponent(EXPO_OWNER)}%2F${encodeURIComponent(easProjectSlug)}`);
    const items: any[] = data?.data ?? data ?? [];
    return items.map((c: any) => ({
      id:         c.id ?? "",
      name:       c.name ?? "",
      branchName: c.branchMappingString ?? c.branchName ?? null,
      createdAt:  c.createdAt ?? new Date().toISOString(),
    }));
  } catch (err) {
    console.warn("[easUpdate] listChannels failed (non-fatal):", err);
    return [];
  }
}

export interface OtaPublishResult {
  updateId:  string;
  branch:    string;
  message:   string;
  platform:  string;
  createdAt: string;
}

/** Publish an OTA update via EAS CLI using the project's actual Expo files */
export async function publishOtaUpdate(opts: {
  easProjectSlug: string;
  accountName:    string;
  branch:         string;
  message:        string;
  projectFiles:   Record<string, string>;
}): Promise<OtaPublishResult> {
  const { easProjectSlug, accountName, branch, message, projectFiles } = opts;
  const token = process.env.EXPO_TOKEN;
  if (!token) throw new Error("EXPO_TOKEN not set");

  const { writeFile: wf, mkdir: mk } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "nexus-ota-"));

  // Write the actual generated project files to the temp dir.
  // Containment check: resolve each target path and verify it stays inside dir.
  for (const [filePath, content] of Object.entries(projectFiles)) {
    const resolved = resolve(dir, filePath);
    if (!resolved.startsWith(dir + "/") && resolved !== dir) {
      throw new Error(`Path traversal rejected: ${filePath}`);
    }
    await mk(join(resolved, ".."), { recursive: true }).catch(() => undefined);
    await wf(resolved, content, "utf8");
  }

  // Ensure app.json exists with proper EAS slug linkage
  const appJson = JSON.stringify({
    expo: { name: easProjectSlug, slug: easProjectSlug, version: "1.0.0", owner: accountName },
  }, null, 2);
  await wf(join(dir, "app.json"), appJson, "utf8");

  // eas.json — project linkage so `eas update` targets the right project
  const easJson = JSON.stringify({
    cli: { version: ">= 5.0.0" },
    build: { preview: { distribution: "internal" } },
    submit: { production: {} },
  }, null, 2);
  await wf(join(dir, "eas.json"), easJson, "utf8");

  const { stdout } = await execFileAsync(
    EAS_BIN,
    ["update", "--branch", branch, "--message", message, "--non-interactive", "--json"],
    {
      cwd: dir,
      timeout: 180_000,
      env: { ...process.env, EXPO_TOKEN: token, CI: "1", EXPO_NO_TELEMETRY: "1" },
    },
  );

  let parsed: any = {};
  try { parsed = JSON.parse(stdout.trim()); } catch { /* ignore */ }
  const update = Array.isArray(parsed) ? parsed[0] : parsed;

  return {
    updateId:  update?.id ?? update?.updateId,
    branch:    update?.branchName ?? branch,
    message:   update?.message ?? message,
    platform:  update?.platform ?? "android,ios",
    createdAt: update?.createdAt ?? new Date().toISOString(),
  };
}

/** List EAS branches for a project slug */
export async function listBranches(easProjectSlug: string): Promise<OtaBranch[]> {
  try {
    const data = await easGet(`/v2/branches?appId=${encodeURIComponent(EXPO_OWNER)}%2F${encodeURIComponent(easProjectSlug)}`);
    const items: any[] = data?.data ?? data ?? [];
    return items.map((b: any) => ({
      id:        b.id ?? "",
      name:      b.name ?? "",
      createdAt: b.createdAt ?? new Date().toISOString(),
    }));
  } catch (err) {
    console.warn("[easUpdate] listBranches failed (non-fatal):", err);
    return [];
  }
}
