const TOKEN_KEY = "nexus-token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export interface TokenPayload {
  userId: string;
  username: string;
  isAdmin: boolean;
  isVip: boolean;
  plan: string;
  exp: number;
}

export function parseToken(token: string): TokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

export const BASE_URL = import.meta.env.BASE_URL ?? "/";

export function apiUrl(path: string): string {
  const base = BASE_URL.replace(/\/$/, "");
  return `${base}/api${path}`;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(apiUrl(path), { ...options, headers });
}
