import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile as wf, mkdir as mk, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";

const execFileAsync = promisify(execFile);
const EXPO_OWNER = "Nexuselitestudio";
const EAS_API    = "https://api.expo.dev";
const EAS_BIN    = resolve(process.cwd(), "artifacts/api-server/node_modules/.bin/eas");

/**
 * Build a minimal, allowlisted environment for child processes that run
 * in untrusted temp directories.  Critically: we do NOT spread process.env
 * because that would expose OPENROUTER_API_KEY, JWT_SECRET, STRIPE_* keys,
 * ADMIN_PASSWORD, RENDER_API_KEY, DATABASE_URL, and all other platform secrets
 * to any lifecycle script that a malicious or compromised dependency might run.
 *
 * Only variables necessary for npm / eas to function are included.
 * The caller adds extras (e.g. EXPO_TOKEN) as needed.
 */
function buildSafeEnv(extras: Record<string, string> = {}): NodeJS.ProcessEnv {
  const safe: Record<string, string> = {
    PATH:              process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME:              process.env.HOME ?? "/root",
    TMPDIR:            process.env.TMPDIR ?? tmpdir(),
    CI:                "1",
    TERM:              "dumb",
    LANG:              process.env.LANG ?? "en_US.UTF-8",
    EXPO_NO_TELEMETRY: "1",
    // npm / node version managers
    ...(process.env.NVM_DIR            ? { NVM_DIR:            process.env.NVM_DIR }            : {}),
    ...(process.env.npm_config_cache   ? { npm_config_cache:   process.env.npm_config_cache }   : {}),
    ...(process.env.NPM_CONFIG_CACHE   ? { NPM_CONFIG_CACHE:   process.env.NPM_CONFIG_CACHE }   : {}),
    ...(process.env.npm_config_prefix  ? { npm_config_prefix:  process.env.npm_config_prefix }  : {}),
  };
  return { ...safe, ...extras };
}

/** Blocked lifecycle script keys — deny any package.json that defines these */
const BLOCKED_PKG_SCRIPTS = new Set([
  "preinstall", "install", "postinstall",
  "prepack", "pack", "postpack",
  "prepublish", "prepublishOnly",
]);

/**
 * Validate a generated package.json string.
 * Throws if it contains lifecycle scripts that could execute arbitrary code
 * during `npm install`.  This is a defence-in-depth check on top of
 * `--ignore-scripts`; belt AND suspenders.
 */
function validatePackageJson(content: string, filePath: string): void {
  let pkg: any;
  try { pkg = JSON.parse(content); } catch { return; } // not valid JSON → npm will reject it anyway
  if (!pkg.scripts || typeof pkg.scripts !== "object") return;
  for (const key of BLOCKED_PKG_SCRIPTS) {
    if (key in pkg.scripts) {
      throw new Error(
        `[easUpdate] Security: generated ${filePath} contains blocked lifecycle script "${key}". ` +
        "Lifecycle scripts are not allowed in platform-managed project files.",
      );
    }
  }
}

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

    // Security: validate package.json files for dangerous lifecycle scripts
    // before writing them.  This is defence-in-depth on top of --ignore-scripts.
    if (filePath === "package.json" || filePath.endsWith("/package.json")) {
      validatePackageJson(content, filePath);
    }

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
  //
  // SECURITY: We pass --ignore-scripts to prevent lifecycle scripts (preinstall,
  // postinstall, etc.) in any dependency from executing arbitrary code on this
  // server.  Combined with validatePackageJson() above (which blocks dangerous
  // scripts in the generated package.json itself), this prevents RCE and
  // secret-exfiltration attacks via the dependency graph.
  //
  // We also use buildSafeEnv() — NOT process.env — so that no platform secrets
  // (OPENROUTER_API_KEY, JWT_SECRET, STRIPE_*, ADMIN_PASSWORD, DATABASE_URL,
  // RENDER_API_KEY, EXPO_TOKEN, etc.) are accessible to child processes or their
  // lifecycle scripts.  EXPO_TOKEN is intentionally withheld here; it is only
  // passed to the `eas update` step (Step 4) which actually needs it.
  console.log("[easUpdate] Installing Expo dependencies (Metro bundler requirement)…");
  try {
    const { stdout: npmOut } = await execFileAsync(
      "npm",
      [
        "install",
        "--ignore-scripts",       // prevent lifecycle script execution
        "--legacy-peer-deps",
        "--prefer-offline",
        "--no-audit",
        "--no-fund",
      ],
      {
        cwd:     dir,
        timeout: 360_000, // 6 minutes
        env:     buildSafeEnv(),  // no secrets — EXPO_TOKEN deliberately excluded
      },
    );
    console.log("[easUpdate] npm install done:", npmOut.slice(0, 200));
  } catch (npmErr: any) {
    throw new Error(`[easUpdate] npm install failed (required for eas update): ${npmErr?.message ?? npmErr}`);
  }

  // ── Step 4: Run eas update ───────────────────────────────────────────────
  // SECURITY: buildSafeEnv() provides only what EAS CLI needs — PATH, HOME,
  // and EXPO_TOKEN.  All other platform secrets remain out of scope.
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
      env:     buildSafeEnv({ EXPO_TOKEN: token }),
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
