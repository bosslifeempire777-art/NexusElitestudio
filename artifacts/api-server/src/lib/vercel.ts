const VERCEL_API_BASE = "https://api.vercel.com";

export function isVercelConfigured(): boolean {
  return !!process.env["VERCEL_TOKEN"];
}

function getToken(): string {
  const t = process.env["VERCEL_TOKEN"];
  if (!t) throw new Error("VERCEL_TOKEN is not configured");
  return t;
}

function getTeamId(): string | null {
  return process.env["VERCEL_TEAM_ID"] || null;
}

async function vercelFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const teamId = getTeamId();
  let url = `${VERCEL_API_BASE}${path}`;
  if (teamId) {
    const sep = url.includes("?") ? "&" : "?";
    url += `${sep}teamId=${encodeURIComponent(teamId)}`;
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(init.headers || {}),
  };
  return fetch(url, { ...init, headers });
}

export async function pingVercel(): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const res = await vercelFetch("/v2/user");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { user?: { username?: string; name?: string } };
    return { ok: true, username: data?.user?.username || data?.user?.name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface CreateVercelDeploymentInput {
  slug: string;
  html: string;
}

export interface CreateVercelDeploymentResult {
  ok: boolean;
  deploymentId?: string;
  url?: string;
  error?: string;
}

export async function createVercelDeployment(
  input: CreateVercelDeploymentInput,
): Promise<CreateVercelDeploymentResult> {
  try {
    const projectName = `nexus-${input.slug}`
      .slice(0, 52)
      .replace(/[^a-z0-9-]/gi, "-")
      .toLowerCase();

    const body = {
      name: projectName,
      files: [{ file: "index.html", data: input.html }],
      projectSettings: {
        framework: null,
        buildCommand: null,
        outputDirectory: null,
        installCommand: null,
        devCommand: null,
      },
      target: "production",
    };

    const res = await vercelFetch("/v13/deployments", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Vercel ${res.status}: ${text.slice(0, 400)}` };
    }

    const data = (await res.json()) as { id?: string; url?: string; readyState?: string };
    return {
      ok: true,
      deploymentId: data.id,
      url: data.url ? `https://${data.url}` : undefined,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface VercelDeploymentStatus {
  ok: boolean;
  readyState?: string;
  url?: string;
  error?: string;
}

export async function getVercelDeploymentStatus(
  deploymentId: string,
): Promise<VercelDeploymentStatus> {
  try {
    const res = await vercelFetch(`/v13/deployments/${encodeURIComponent(deploymentId)}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { readyState?: string; url?: string };
    return {
      ok: true,
      readyState: data.readyState,
      url: data.url ? `https://${data.url}` : undefined,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteVercelDeployment(
  deploymentId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await vercelFetch(`/v13/deployments/${encodeURIComponent(deploymentId)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function injectNexusApi(html: string, nexusApiUrl: string, projectId: string): string {
  const injection = `<script>window.NEXUS_API="${nexusApiUrl}";window.NEXUS_PROJECT_ID="${projectId}";</script>`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${injection}</head>`);
  }
  return injection + html;
}
