import * as React from 'react';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  signInWithPassword,
  signUpWithPassword,
  signOut,
  getCurrentUser,
  onAuthStateChanged,
} from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

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

/**
 * Map Supabase user metadata to our AuthUser interface
 */
function mapSupabaseUserToAuthUser(supabaseUser: User | null): AuthUser | null {
  if (!supabaseUser) {
    return null;
  }

  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? null,
    username:
      supabaseUser.user_metadata?.username ??
      supabaseUser.email?.split('@')[0],
    plan: supabaseUser.user_metadata?.plan ?? 'free',
    isAdmin: supabaseUser.user_metadata?.isAdmin ?? false,
    isVip: supabaseUser.user_metadata?.isVip ?? false,
    projectCount: supabaseUser.user_metadata?.projectCount ?? 0,
    buildsThisMonth: supabaseUser.user_metadata?.buildsThisMonth ?? 0,
    creditBalance: supabaseUser.user_metadata?.creditBalance ?? 0,
    createdAt: supabaseUser.created_at,
  };
}

/**
 * Convert Supabase auth errors to user-friendly messages
 */
function friendlyAuthError(error: string): string {
  const lowerError = error.toLowerCase();

  if (lowerError.includes('invalid login credentials')) {
    return 'Invalid email or password.';
  }
  if (lowerError.includes('user already exists')) {
    return 'This email is already registered.';
  }
  if (lowerError.includes('password')) {
    return 'Password must be at least 6 characters.';
  }
  if (lowerError.includes('email')) {
    return 'Please enter a valid email address.';
  }
  if (lowerError.includes('network')) {
    return 'Network error. Please check your connection and try again.';
  }
  if (lowerError.includes('rate_limit')) {
    return 'Too many login attempts. Please try again later.';
  }

  return error || 'An unexpected error occurred.';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Initialize auth state when component mounts
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const currentUser = await getCurrentUser();
        if (currentUser) {
          setUser(mapSupabaseUserToAuthUser(currentUser));
        }
      } catch (error) {
        console.error('[auth] Error initializing auth:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, []);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged((supabaseUser) => {
      if (supabaseUser) {
        const mappedUser = mapSupabaseUserToAuthUser(supabaseUser);
        setUser(mappedUser);
      } else {
        setUser(null);
      }
    });

    return () => {
      if (unsubscribe?.unsubscribe) {
        unsubscribe.unsubscribe();
      }
    };
  }, []);

  const login = useCallback(
    async (emailOrUsername: string, password: string) => {
      try {
        setLoading(true);
        await signInWithPassword(emailOrUsername, password);
        // User state will be updated by onAuthStateChanged listener
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Login failed';
        throw new Error(friendlyAuthError(errorMessage));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const register = useCallback(
    async (
      username: string,
      email: string,
      password: string,
      referralCode?: string
    ) => {
      try {
        setLoading(true);

        // Validate password length
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters');
        }

        await signUpWithPassword(email, password, username, referralCode);
        // User state will be updated by onAuthStateChanged listener
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Registration failed';
        throw new Error(friendlyAuthError(errorMessage));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      setLoading(true);
      await signOut();
      setUser(null);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Logout failed';
      throw new Error(friendlyAuthError(errorMessage));
    } finally {
      setLoading(false);
    }
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    login,
    register,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

/**
 * Hook to use auth context
 * Must be used inside AuthProvider
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
