import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL     as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/**
 * Sign in with email and password.
 * Accepts either email or username (converts username to email).
 */
export async function signInWithPassword(emailOrUsername: string, password: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  const email = emailOrUsername.includes('@')
    ? emailOrUsername
    : `${emailOrUsername}@nexuselite.local`;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Sign up with email, password, and optional username.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
  username?: string,
  referralCode?: string
) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username: username || email.split('@')[0],
        referralCode: referralCode || null,
      },
    },
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Sign out the current user.
 */
export async function signOut() {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

/**
 * Get the current authenticated user.
 */
export async function getCurrentUser() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error('[supabase] Error getting current user:', error.message);
    return null;
  }
  return data.user;
}

/**
 * Get the current session.
 */
export async function getSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[supabase] Error getting session:', error.message);
    return null;
  }
  return data.session;
}

/**
 * Listen to authentication state changes.
 * Returns an unsubscribe handle, or null if Supabase is not configured.
 */
export function onAuthStateChanged(
  callback: (user: any | null) => void
): { unsubscribe: () => void } | null {
  if (!supabase) return null;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return data?.subscription || null;
}
