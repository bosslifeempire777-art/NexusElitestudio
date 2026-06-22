/**
 * Expo Snack API integration.
 * Uploads generated Expo React Native files to snack.expo.dev so users
 * can preview the app instantly in Expo Go by scanning a QR code — no EAS
 * build or native compilation required.
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

/**
 * Upload Expo project files to Snack and return URLs for web embed and Expo Go.
 */
export async function uploadToExpoSnack(
  name: string,
  description: string,
  files: Record<string, string>,
): Promise<SnackResult> {
  const snackFiles: Record<string, { type: "CODE"; contents: string }> = {};

  for (const [path, contents] of Object.entries(files)) {
    if (!isCodeFile(path)) continue;
    if (!contents || contents.trim().length === 0) continue;
    snackFiles[path] = { type: "CODE", contents };
  }

  if (Object.keys(snackFiles).length === 0) {
    throw new Error("No code files to upload to Snack");
  }

  const body = {
    name:        name.slice(0, 100),
    description: description.slice(0, 500),
    sdkVersion:  SDK_VERSION,
    files:       snackFiles,
  };

  const res = await fetch(SNACK_SAVE_URL, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Expo-Platform": "web",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Snack API ${res.status}: ${text.slice(0, 200)}`);
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
