import * as React from 'react';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getToken, setToken, clearToken, apiFetch } from '@/lib/auth';

interface AuthUser {
  id: string;
  email: string | null;
  username?: string;
  plan?: string;
  isAdmin?: boolean;
  isVip?: boolean;
  projectCount?: number;
  buildsThisMonth?: number;
  creditBalance?: number;
  createdAt?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
    referralCode?: string
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: if a token is already stored, fetch /api/auth/me to restore session.
  // Also refresh the token so plan/admin flags are always up to date.
  useEffect(() => {
    const restore = async () => {
      const token = getToken();
      if (!token) { setLoading(false); return; }
      try {
        const refreshRes = await apiFetch('/auth/refresh', { method: 'POST' });
        if (refreshRes.ok) {
          const { token: newToken, user: u } = await refreshRes.json();
          setToken(newToken);
          setUser(u);
        } else {
          // Token invalid/expired — clear it
          clearToken();
        }
      } catch {
        // Network failure — keep the stale user data from the existing token
        const meRes = await apiFetch('/auth/me').catch(() => null);
        if (meRes?.ok) setUser(await meRes.json());
        else clearToken();
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, []);

  const login = useCallback(async (emailOrUsername: string, password: string) => {
    setLoading(true);
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: emailOrUsername, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? 'Invalid credentials');
      }
      const { token, user: u } = await res.json();
      setToken(token);
      setUser(u);
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (
    username: string,
    email: string,
    password: string,
    referralCode?: string
  ) => {
    setLoading(true);
    try {
      const res = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password, referralCode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? 'Registration failed');
      }
      const { token, user: u } = await res.json();
      setToken(token);
      setUser(u);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    clearToken();
    setUser(null);
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
  }, []);

  const value: AuthContextValue = { user, loading, login, register, logout };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
