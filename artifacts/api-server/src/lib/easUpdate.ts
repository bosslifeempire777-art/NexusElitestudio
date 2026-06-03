const EXPO_OWNER = "Nexuselitestudio";
const EAS_API    = "https://api.expo.dev";

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
