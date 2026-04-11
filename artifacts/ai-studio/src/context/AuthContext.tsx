import * as React from "react";
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getToken, setToken, clearToken, parseToken, type TokenPayload, apiFetch } from "@/lib/auth";

interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  plan: string;
  isAdmin: boolean;
  isVip: boolean;
  projectCount: number;
  buildsThisMonth: number;
  createdAt: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  tokenPayload: TokenPayload | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, referralCode?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const tokenPayload = React.useMemo(() => {
    const t = getToken();
    return t ? parseToken(t) : null;
  }, [user]);

  const fetchMe = useCallback(async () => {
    const token = getToken();
    if (!token || !parseToken(token)) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch("/auth/me");
      if (res.ok) {
        setUser(await res.json());
      } else {
        clearToken();
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    setToken(data.token);
    setUser(data.user);
  }, []);

  const register = useCallback(async (username: string, email: string, password: string, referralCode?: string) => {
    const res = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password, ...(referralCode ? { referralCode } : {}) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, tokenPayload, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
