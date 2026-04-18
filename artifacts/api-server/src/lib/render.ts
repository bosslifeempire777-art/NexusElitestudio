const RENDER_API_BASE = "https://api.render.com/v1";

export interface RenderServiceSummary {
  id: string;
  name: string;
  serviceUrl?: string;
  state?: string;
}

function getApiKey(): string | null {
  return process.env["RENDER_API_KEY"] || null;
}

async function renderFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const key = getApiKey();
  if (!key) throw new Error("RENDER_API_KEY is not configured");
  const headers = {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...(init.headers || {}),
  };
  return fetch(`${RENDER_API_BASE}${path}`, { ...init, headers });
}

export async function pingRender(): Promise<{ ok: boolean; ownerCount?: number; error?: string }> {
  try {
    const res = await renderFetch("/owners?limit=1");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as unknown;
    const count = Array.isArray(data) ? data.length : 0;
    return { ok: true, ownerCount: count };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function addCustomDomainToService(
  serviceId: string,
  domain: string,
): Promise<{ ok: boolean; verificationTarget?: string; error?: string }> {
  try {
    const res = await renderFetch(`/services/${serviceId}/custom-domains`, {
      method: "POST",
      body: JSON.stringify({ name: domain }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { domainType?: string; verificationStatus?: string };
    return { ok: true, verificationTarget: data.domainType };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function isRenderConfigured(): boolean {
  return !!getApiKey();
}
