import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your .env.local'
  );
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Sign in with email and password
 * Accepts either email or username (converts username to email)
 */
export async function signInWithPassword(emailOrUsername: string, password: string) {
  // If it looks like a username (no @), append domain
  const email = emailOrUsername.includes('@')
    ? emailOrUsername
    : `${emailOrUsername}@nexuselite.local`;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

/**
 * Sign up with email, password, and optional username
 */
export async function signUpWithPassword(
  email: string,
  password: string,
  username?: string,
  referralCode?: string
) {
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

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

/**
 * Sign out the current user
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Get the current authenticated user
 */
export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    console.error('[supabase] Error getting current user:', error.message);
    return null;
  }

  return data.user;
}

/**
 * Get the current session
 */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error('[supabase] Error getting session:', error.message);
    return null;
  }

  return data.session;
}

/**
 * Listen to authentication state changes
 * Returns an unsubscribe function
 */
export function onAuthStateChanged(
  callback: (user: any | null) => void
): { unsubscribe: () => void } | null {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });

  return data?.subscription || null;
}
