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

function getOwnerId(): string | null {
  return process.env["RENDER_OWNER_ID"] || null;
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

/**
 * Fetch the first owner id from the Render account. Used as a fallback when
 * RENDER_OWNER_ID is not explicitly set.
 */
async function resolveOwnerId(): Promise<string | null> {
  const explicit = getOwnerId();
  if (explicit) return explicit;
  try {
    const res = await renderFetch("/owners?limit=1");
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ owner?: { id?: string } }>;
    return data?.[0]?.owner?.id ?? null;
  } catch {
    return null;
  }
}

export interface CreateRenderServiceInput {
  name: string;
  /**
   * Public HTTPS URL from which the container downloads the frontend HTML
   * (stored as FRONTEND_URL). Typically the platform's /:id/preview endpoint.
   */
  proxyTarget: string;
  /**
   * Public HTTPS URL from which the container downloads the Node.js server code
   * (stored as SERVER_JS_URL). Typically the platform's /:id/server endpoint.
   * When provided the service runs as a full Node.js app; omit to fall back to
   * the legacy static-busybox deployment.
   */
  serverTarget?: string;
  /** Region slug, e.g. "oregon", "frankfurt". Defaults to "oregon". */
  region?: string;
  /** Render plan slug. Defaults to "starter" (cheapest paid web service tier). */
  plan?: string;
}

export interface CreateRenderServiceResult {
  ok: boolean;
  serviceId?: string;
  serviceUrl?: string;
  error?: string;
}

/**
 * Create a dedicated Render web service that serves the project HTML
 * statically from its own container — no traffic flows back to the
 * main API server at runtime. The service is provisioned from the
 * public `alpine:3.19` image with a startup command that wgets the
 * project HTML once from `proxyTarget` into local storage and then
 * serves it with `busybox httpd`. To pick up new project code, call
 * `triggerRenderRedeploy(serviceId)` which forces the container to
 * restart and re-fetch the HTML.
 */
export async function createRenderService(
  input: CreateRenderServiceInput,
): Promise<CreateRenderServiceResult> {
  try {
    const ownerId = await resolveOwnerId();
    if (!ownerId) return { ok: false, error: "Could not resolve Render owner id" };

    const region = input.region || process.env["RENDER_REGION"] || "oregon";
    const plan = input.plan || process.env["RENDER_PLAN"] || "starter";
    // Use a tiny public Alpine image. At startup it pulls the project HTML
    // ONCE from the source URL into local storage, then serves it with
    // BusyBox httpd. After the initial fetch every request is handled
    // entirely by the dedicated Render service — no traffic flows back
    // through our main API server, which is the whole point of decoupling.
    const image = process.env["RENDER_DEPLOY_IMAGE"] || "alpine:3.19";

    // Full-stack Node.js deployment (default when serverTarget is provided):
    // 1. Install Node.js on Alpine
    // 2. Download the generated server.js from the platform
    // 3. Download the frontend HTML into public/
    // 4. Install express + cors (pure-JS, no native compilation)
    // 5. Run node server.js — serves the API and frontend from one process
    //
    // Falls back to legacy static busybox serve when serverTarget is absent.
    const dockerCommand = input.serverTarget
      ? `sh -c 'set -e; ` +
        `apk add --no-cache nodejs npm; ` +
        `mkdir -p /app/public; ` +
        `wget -qO /app/server.js "$SERVER_JS_URL" || echo "console.error(\\\"server.js unavailable\\\");" > /app/server.js; ` +
        `wget -qO /app/public/index.html "$FRONTEND_URL" || echo "<!DOCTYPE html><html><body><h1>Loading...</h1></body></html>" > /app/public/index.html; ` +
        `cd /app && npm init -y && npm install --save-exact express@4.18.2 cors@2.8.5; ` +
        `exec node server.js'`
      : `sh -c 'set -e; mkdir -p /www; ` +
        `wget -qO /www/index.html "$FRONTEND_URL" || ` +
        `(echo "<h1>Source unavailable</h1>" > /www/index.html); ` +
        `exec busybox httpd -f -p "$PORT" -h /www'`;

    const envVars: Array<{ key: string; value: string }> = [
      { key: "FRONTEND_URL", value: input.proxyTarget },
    ];
    if (input.serverTarget) {
      envVars.push({ key: "SERVER_JS_URL", value: input.serverTarget });
    }

    const body = {
      type: "web_service",
      name: input.name,
      ownerId,
      image: { ownerId, imagePath: image },
      envVars,
      serviceDetails: {
        env: "image",
        region,
        plan,
        envSpecificDetails: { dockerCommand },
        healthCheckPath: "/",
      },
    };

    const res = await renderFetch("/services", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${text.slice(0, 300)}` };
    }
    const data = (await res.json()) as { service?: { id?: string; serviceDetails?: { url?: string } } };
    const svc = data.service;
    return {
      ok: true,
      serviceId: svc?.id,
      serviceUrl: svc?.serviceDetails?.url,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface RenderServiceStatus {
  ok: boolean;
  state?: string;
  serviceUrl?: string;
  suspended?: boolean;
  error?: string;
}

export async function getRenderServiceStatus(serviceId: string): Promise<RenderServiceStatus> {
  try {
    const res = await renderFetch(`/services/${serviceId}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as {
      suspended?: string;
      serviceDetails?: { url?: string };
    };
    // Render reports the latest deploy state via a separate endpoint:
    let state: string | undefined;
    const dRes = await renderFetch(`/services/${serviceId}/deploys?limit=1`);
    if (dRes.ok) {
      const deploys = (await dRes.json()) as Array<{ deploy?: { status?: string } }>;
      state = deploys?.[0]?.deploy?.status;
    }
    return {
      ok: true,
      state,
      serviceUrl: data.serviceDetails?.url,
      suspended: data.suspended === "suspended",
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Trigger a fresh deploy on a Render service. Because our static-content
 * approach snapshots the project HTML at container start, this is the
 * mechanism that picks up new project code after a Nexus redeploy.
 */
export async function triggerRenderRedeploy(
  serviceId: string,
): Promise<{ ok: boolean; deployId?: string; error?: string }> {
  try {
    const res = await renderFetch(`/services/${serviceId}/deploys`, {
      method: "POST",
      body: JSON.stringify({ clearCache: "do_not_clear" }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, deployId: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteRenderService(serviceId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await renderFetch(`/services/${serviceId}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Strip protocol/path from a URL and return just the hostname, suitable for
 * use as a CNAME target. Returns null if the input can't be parsed.
 */
export function urlToHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.hostname.replace(/\.+$/, "").toLowerCase() || null;
  } catch {
    return null;
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
    // Render returns the domain object; the actual CNAME target users need
    // to set is the service's *.onrender.com hostname, not any field in
    // this response. Look it up from the service so we always hand the
    // user a real DNS hostname.
    const svc = await getRenderServiceStatus(serviceId);
    const target = urlToHostname(svc.serviceUrl ?? null) ?? undefined;
    return { ok: true, verificationTarget: target };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Look up a custom domain attached to a Render service by hostname and
 * delete it. Best-effort: returns ok:true if the domain isn't there.
 */
export async function removeCustomDomainFromService(
  serviceId: string,
  domain: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const listRes = await renderFetch(`/services/${serviceId}/custom-domains?limit=100`);
    if (!listRes.ok) {
      const text = await listRes.text().catch(() => "");
      return { ok: false, error: `${listRes.status} ${text.slice(0, 200)}` };
    }
    const list = (await listRes.json()) as Array<{ customDomain?: { id?: string; name?: string } }>;
    const wanted = domain.toLowerCase();
    const match = list.find((row) => row.customDomain?.name?.toLowerCase() === wanted);
    const id = match?.customDomain?.id;
    if (!id) return { ok: true }; // already gone
    const delRes = await renderFetch(`/services/${serviceId}/custom-domains/${id}`, {
      method: "DELETE",
    });
    if (!delRes.ok && delRes.status !== 404) {
      const text = await delRes.text().catch(() => "");
      return { ok: false, error: `${delRes.status} ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function isRenderConfigured(): boolean {
  return !!getApiKey();
}
