/**
 * Expo Snack API integration.
 * Uploads generated Expo React Native files to snack.expo.dev so users
 * can preview the app instantly in Expo Go by scanning a QR code — no EAS
 * build or native compilation required.
 *
 * API format (v2):
 *   POST https://exp.host/--/api/v2/snack/save
 *   Body: { name, description, sdkVersion, manifest: { dependencies }, code: { [path]: { type:"CODE", contents } } }
 */

export interface SnackResult {
  hashId: string;
  url: string;
  embedUrl: string;
  expoGoUrl: string;
}

const SNACK_SAVE_URL = "https://exp.host/--/api/v2/snack/save";
const SDK_VERSION    = "51.0.0";

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".json", ".md",
]);

function isCodeFile(path: string): boolean {
  if (path.startsWith("assets/")) return false;
  const lower = path.toLowerCase();
  return CODE_EXTENSIONS.has("." + lower.split(".").pop());
}

/** Extract dependency map from a package.json string, falling back to sensible defaults. */
function extractDependencies(files: Record<string, string>): Record<string, string> {
  const defaults: Record<string, string> = {
    "expo":                           "~51.0.0",
    "expo-router":                    "~3.5.0",
    "expo-status-bar":                "~1.12.1",
    "react":                          "18.2.0",
    "react-native":                   "0.74.5",
    "react-native-safe-area-context": "4.10.5",
    "react-native-screens":           "~3.31.1",
    "@expo/vector-icons":             "^14.0.2",
    "expo-font":                      "~12.0.9",
    "expo-splash-screen":             "~0.27.5",
    "@react-native-async-storage/async-storage": "1.23.1",
  };

  try {
    const pkgRaw = files["package.json"];
    if (pkgRaw) {
      const pkg = JSON.parse(pkgRaw);
      const deps = pkg.dependencies ?? {};
      if (Object.keys(deps).length > 0) return deps;
    }
  } catch { /* fall through */ }

  return defaults;
}

/**
 * Upload Expo project files to Snack and return URLs for web embed and Expo Go.
 */
export async function uploadToExpoSnack(
  name: string,
  description: string,
  files: Record<string, string>,
): Promise<SnackResult> {
  const codeFiles: Record<string, { type: "CODE"; contents: string }> = {};

  for (const [path, contents] of Object.entries(files)) {
    if (!isCodeFile(path)) continue;
    if (path === "package.json") continue; // deps go in manifest, not code
    if (!contents || contents.trim().length === 0) continue;
    codeFiles[path] = { type: "CODE", contents };
  }

  if (Object.keys(codeFiles).length === 0) {
    throw new Error("No code files to upload to Snack");
  }

  const dependencies = extractDependencies(files);

  const body = {
    name:        name.slice(0, 100),
    description: description.slice(0, 500),
    manifest:    { sdkVersion: SDK_VERSION, dependencies },
    code:        codeFiles,
  };

  // Include Expo token so the Snack is saved under the Nexuselitestudio account
  const headers: Record<string, string> = {
    "Content-Type":  "application/json",
    "Expo-Platform": "web",
  };
  const expoToken = process.env.EXPO_TOKEN;
  if (expoToken) headers["Authorization"] = `Bearer ${expoToken}`;

  const res = await fetch(SNACK_SAVE_URL, {
    method: "POST",
    headers,
    body:   JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Snack API ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json() as { id?: string; hashId?: string };
  const hashId = data.hashId ?? data.id ?? "";
  if (!hashId) throw new Error("Snack API returned no hash ID");

  return {
    hashId,
    url:        `https://snack.expo.dev/${hashId}`,
    embedUrl:   `https://snack.expo.dev/embedded?platform=android&preview=true&theme=dark&snack-id=${hashId}&hideQueryParams=true`,
    expoGoUrl:  `https://snack.expo.dev/${hashId}`,
  };
}
