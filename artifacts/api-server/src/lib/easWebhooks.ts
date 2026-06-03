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

/** Register a webhook with EAS for a given app slug */
export async function createEasWebhook(opts: {
  appSlug: string;
  url:     string;
  secret:  string;
  events:  WebhookEvent[];
}): Promise<string> {
  const { appSlug, url, secret, events } = opts;

  try {
    const res  = await fetch(`${EAS_API}/v2/webhooks`, {
      method:  "POST",
      headers: easHeaders(),
      body:    JSON.stringify({ appSlug, url, secret, events }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`EAS CreateWebhook ${res.status}: ${text.slice(0, 300)}`);
    const data: any = JSON.parse(text);
    return data?.data?.id ?? data?.id ?? "";
  } catch (err) {
    console.warn("[easWebhooks] createEasWebhook failed (non-fatal):", err);
    return "";
  }
}

/** Delete a webhook from EAS */
export async function deleteEasWebhook(easWebhookId: string): Promise<void> {
  try {
    const res = await fetch(`${EAS_API}/v2/webhooks/${easWebhookId}`, {
      method:  "DELETE",
      headers: easHeaders(),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[easWebhooks] deleteEasWebhook ${res.status}: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn("[easWebhooks] deleteEasWebhook failed (non-fatal):", err);
  }
}
