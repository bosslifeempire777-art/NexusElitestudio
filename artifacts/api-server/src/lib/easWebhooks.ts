const EAS_API = "https://api.expo.dev";

function easHeaders(): Record<string, string> {
  const token = process.env.EXPO_TOKEN;
  if (!token) throw new Error("EXPO_TOKEN not set");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export type WebhookEvent = "BUILD" | "SUBMIT" | "UPDATE";

export interface EasWebhookRemote {
  id:        string;
  url:       string;
  events:    WebhookEvent[];
  createdAt: string;
}

/** Register a webhook with EAS for a given app slug — throws if EAS rejects */
export async function createEasWebhook(opts: {
  appSlug: string;
  url:     string;
  secret:  string;
  events:  WebhookEvent[];
}): Promise<string> {
  const { appSlug, url, secret, events } = opts;

  const res  = await fetch(`${EAS_API}/v2/webhooks`, {
    method:  "POST",
    headers: easHeaders(),
    body:    JSON.stringify({ appSlug, url, secret, events }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`EAS CreateWebhook ${res.status}: ${text.slice(0, 300)}`);
  const data: any = JSON.parse(text);
  const id = data?.data?.id ?? data?.id;
  if (!id) throw new Error("EAS CreateWebhook: no webhook ID in response");
  return id;
}

/** Delete a webhook from EAS — throws if EAS rejects */
export async function deleteEasWebhook(easWebhookId: string): Promise<void> {
  const res = await fetch(`${EAS_API}/v2/webhooks/${easWebhookId}`, {
    method:  "DELETE",
    headers: easHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EAS DeleteWebhook ${res.status}: ${text.slice(0, 200)}`);
  }
}

/** List webhooks registered with EAS for a given app slug */
export async function listEasWebhooks(appSlug: string): Promise<EasWebhookRemote[]> {
  const res = await fetch(`${EAS_API}/v2/webhooks?appSlug=${encodeURIComponent(appSlug)}`, {
    headers: easHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EAS ListWebhooks ${res.status}: ${text.slice(0, 200)}`);
  }
  const data: any = await res.json();
  const list: any[] = data?.data ?? data ?? [];
  return list.map((w: any) => ({
    id:        w.id,
    url:       w.url,
    events:    w.events ?? [],
    createdAt: w.createdAt ?? new Date().toISOString(),
  }));
}
