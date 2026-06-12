import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile as wf, mkdir as mk, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";

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

/**
 * Publish an OTA update via EAS Update.
 *
 * Key design decisions:
 * - `projectFiles` comes from generateMobileCode() which already includes correctly
 *   configured `app.json` (owner + slug matching EAS project) and `eas.json`.
 *   We write them as-is and do NOT overwrite them with minimal stubs afterwards,
 *   preserving all EAS project linkage.
 * - `npm install --legacy-peer-deps` is run before `eas update` because Metro
 *   bundler (used by `eas update`) requires node_modules to exist locally.
 *   This adds ~2-4 minutes to publish time but is unavoidable for local bundling.
 * - Binary asset files (PNGs stored as base64 in projectFiles) are detected by
 *   extension and decoded before writing so Metro can process them.
 */
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

  const dir = await mkdtemp(join(tmpdir(), "nexus-ota-"));
  const root = resolve(dir) + "/";

  // ── Step 1: Write the complete project files ─────────────────────────────
  // projectFiles from generateMobileCode already includes:
  //   - app.json  (with correct expo.owner, expo.slug for this EAS project)
  //   - eas.json  (with correct build profiles)
  //   - package.json, tsconfig.json, babel.config.js
  //   - all app screens and components
  // We use them as the source of truth; no overwriting afterwards.
  for (const [filePath, content] of Object.entries(projectFiles)) {
    const resolved = resolve(join(dir, filePath));

    // Containment check: reject any path that escapes the temp directory.
    if (!resolved.startsWith(root)) {
      console.warn(`[easUpdate] Skipping unsafe path: ${filePath}`);
      continue;
    }

    await mk(dirname(resolved), { recursive: true });

    // Binary assets (PNGs) are stored as base64 strings in projectFiles
    if (filePath.match(/\.(png|jpg|jpeg|gif|webp)$/i)) {
      const { writeFile: wfBuf } = await import("node:fs/promises");
      await wfBuf(resolved, Buffer.from(content, "base64"));
    } else {
      await wf(resolved, content, "utf8");
    }
  }

  // ── Step 2: Write fallback app.json / eas.json only if absent ────────────
  // (generateMobileCode always includes both, but guard just in case)
  const appJsonPath = join(dir, "app.json");
  const easJsonPath = join(dir, "eas.json");

  const appJsonExists = await access(appJsonPath).then(() => true).catch(() => false);
  if (!appJsonExists) {
    console.warn("[easUpdate] app.json not in projectFiles — writing fallback");
    await wf(appJsonPath, JSON.stringify({
      expo: {
        name:    easProjectSlug,
        slug:    easProjectSlug,
        version: "1.0.0",
        owner:   accountName,
        runtimeVersion: { policy: "appVersion" },
        updates: { enabled: true, fallbackToCacheTimeout: 0 },
      },
    }, null, 2), "utf8");
  }

  const easJsonExists = await access(easJsonPath).then(() => true).catch(() => false);
  if (!easJsonExists) {
    console.warn("[easUpdate] eas.json not in projectFiles — writing fallback");
    await wf(easJsonPath, JSON.stringify({
      cli:   { version: ">= 5.9.0" },
      build: {
        preview: { distribution: "internal", android: { buildType: "apk" } },
      },
      submit: { production: {} },
    }, null, 2), "utf8");
  }

  // ── Step 3: Install dependencies so Metro bundler can run ────────────────
  // `eas update` uses Metro to bundle JS locally before uploading.
  // Without node_modules the bundle step will fail.
  console.log("[easUpdate] Installing Expo dependencies (Metro bundler requirement)…");
  try {
    const { stdout: npmOut } = await execFileAsync(
      "npm",
      ["install", "--legacy-peer-deps", "--prefer-offline", "--no-audit", "--no-fund"],
      {
        cwd:     dir,
        timeout: 360_000, // 6 minutes
        env:     { ...process.env, CI: "1" },
      },
    );
    console.log("[easUpdate] npm install done:", npmOut.slice(0, 200));
  } catch (npmErr: any) {
    throw new Error(`[easUpdate] npm install failed (required for eas update): ${npmErr?.message ?? npmErr}`);
  }

  // ── Step 4: Run eas update ───────────────────────────────────────────────
  console.log(`[easUpdate] Publishing OTA to branch "${branch}" for ${easProjectSlug}…`);
  const { stdout } = await execFileAsync(
    EAS_BIN,
    [
      "update",
      "--branch",  branch,
      "--message", message,
      "--non-interactive",
      "--json",
    ],
    {
      cwd:     dir,
      timeout: 300_000, // 5 minutes (post-install bundling)
      env:     {
        ...process.env,
        EXPO_TOKEN:         token,
        CI:                 "1",
        EXPO_NO_TELEMETRY:  "1",
      },
    },
  );

  let parsed: any = {};
  try { parsed = JSON.parse(stdout.trim()); } catch { /* keep empty parsed */ }
  const update = Array.isArray(parsed) ? parsed[0] : parsed;

  return {
    updateId:  update?.id ?? update?.updateId ?? "unknown",
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
