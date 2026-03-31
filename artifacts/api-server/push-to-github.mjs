import { ReplitConnectors } from "@replit/connectors-sdk";
import { readFileSync, statSync } from "fs";
import { execSync } from "child_process";

const connectors = new ReplitConnectors();
const WORKSPACE = "/home/runner/workspace";
const REPO_NAME = "nexuselite-ai-studio";
const MAX_FILE_BYTES = 50 * 1024; // skip files > 50 KB (proxy body limit ~100 KB)

async function gh(endpoint, options = {}) {
  const res = await connectors.proxy("github", endpoint, options);
  if (!res.ok && res.status >= 400) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status} on ${endpoint}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function ghPost(endpoint, body) {
  return gh(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function ghPut(endpoint, body) {
  return gh(endpoint, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// ── 1. Get user ───────────────────────────────────────────────────────────────
console.log("🔍 Fetching GitHub user...");
const user = await gh("/user");
console.log(`✅ Authenticated as: ${user.login}`);

const repoPath = `/repos/${user.login}/${REPO_NAME}`;

// ── 2. Collect files ──────────────────────────────────────────────────────────
console.log("📂 Collecting files...");
const EXCLUDE_EXT = [".tar.gz", ".gz"];
const EXCLUDE_DIRS = ["attached_assets/", ".local/"];

const allFiles = execSync("git ls-files", { cwd: WORKSPACE })
  .toString().trim().split("\n")
  .filter((f) => {
    if (EXCLUDE_EXT.some((ext) => f.endsWith(ext))) return false;
    if (EXCLUDE_DIRS.some((dir) => f.startsWith(dir))) return false;
    return true;
  });

console.log(`📦 ${allFiles.length} source files found`);

// ── 3. Ensure repo exists ─────────────────────────────────────────────────────
console.log(`\n🏗️  Checking repo "${REPO_NAME}"...`);
let repoUrl;
try {
  const existing = await gh(`/repos/${user.login}/${REPO_NAME}`);
  repoUrl = existing.html_url;
  console.log(`ℹ️  Repo exists: ${repoUrl}`);
} catch (_) {
  const newRepo = await ghPost("/user/repos", {
    name: REPO_NAME,
    description: "NexusElite AI Studio — Autonomous AI Software & Game Studio Builder by BossLife",
    private: false,
    auto_init: false,
  });
  repoUrl = newRepo.html_url;
  console.log(`✅ Created repo: ${repoUrl}`);
}

// ── 4. Get or create base commit ──────────────────────────────────────────────
console.log("\n📌 Getting base commit...");
let baseSha = null;
try {
  const ref = await gh(`${repoPath}/git/refs/heads/main`);
  baseSha = ref?.object?.sha || null;
  if (baseSha) console.log(`ℹ️  Existing main branch: ${baseSha.slice(0, 7)}`);
} catch (_) {}

if (!baseSha) {
  console.log("📄 Initializing repo with README...");
  const readme = Buffer.from(
    "# NexusElite AI Studio\n\nAutonomous AI Software & Game Studio Builder — by BossLife\n"
  ).toString("base64");
  const init = await ghPut(`${repoPath}/contents/README.md`, {
    message: "chore: initialize repo",
    content: readme,
  });
  baseSha = init.commit.sha;
  console.log(`✅ Initialized. Base commit: ${baseSha.slice(0, 7)}`);
}

// ── 5. Create blobs ───────────────────────────────────────────────────────────
console.log("\n📤 Creating blobs...");
const treeItems = [];
let done = 0;
let skipped = 0;

for (const filePath of allFiles) {
  const absPath = `${WORKSPACE}/${filePath}`;
  let content;
  try {
    const stat = statSync(absPath);
    if (stat.size > MAX_FILE_BYTES) {
      console.log(`  ⚠️  skip (too large ${(stat.size/1024/1024).toFixed(1)}MB): ${filePath}`);
      skipped++;
      continue;
    }
    content = readFileSync(absPath);
  } catch (_) {
    console.log(`  ⚠️  skip (unreadable): ${filePath}`);
    skipped++;
    continue;
  }

  const blob = await ghPost(`${repoPath}/git/blobs`, {
    content: content.toString("base64"),
    encoding: "base64",
  });

  treeItems.push({ path: filePath, mode: "100644", type: "blob", sha: blob.sha });
  done++;
  if (done % 25 === 0) console.log(`  → ${done}/${allFiles.length} blobs done`);
}

console.log(`✅ ${treeItems.length} blobs created (${skipped} skipped)`);

// ── 6. Create tree ────────────────────────────────────────────────────────────
console.log("\n🌳 Creating tree...");
const tree = await ghPost(`${repoPath}/git/trees`, { tree: treeItems });
console.log(`✅ Tree: ${tree.sha}`);

// ── 7. Create commit ──────────────────────────────────────────────────────────
console.log("\n💾 Creating commit...");
const commit = await ghPost(`${repoPath}/git/commits`, {
  message: "🚀 Full push — NexusElite AI Studio by BossLife",
  tree: tree.sha,
  parents: [baseSha],
});
console.log(`✅ Commit: ${commit.sha}`);

// ── 8. Force-update main branch ───────────────────────────────────────────────
console.log("\n🌿 Updating main branch...");
await gh(`${repoPath}/git/refs/heads/main`, {
  method: "PATCH",
  body: JSON.stringify({ sha: commit.sha, force: true }),
  headers: { "Content-Type": "application/json" },
});
console.log(`✅ main → ${commit.sha.slice(0, 7)}`);

// ── Done ──────────────────────────────────────────────────────────────────────
console.log(`\n🎉 Done! Your code is live at:\n   ${repoUrl}\n`);
