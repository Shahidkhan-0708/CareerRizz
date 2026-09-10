import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Platform Supabase client. Uses SUPABASE_URL + (service role key when running
 * in workers; anon key + user JWT when called from the API on behalf of a user).
 */
export function getPlatformSupabase(opts?: {
  url?: string;
  serviceRoleKey?: string;
}): SupabaseClient {
  if (cached) return cached;

  const url = opts?.url ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    opts?.serviceRoleKey ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing Supabase configuration: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (workers) or SUPABASE_ANON_KEY (API).',
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Fresh client for per-request user-scoped access (RLS applies). */
export function getUserSupabase(userJwt: string, opts?: { url?: string; anonKey?: string }): SupabaseClient {
  const url = opts?.url ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = opts?.anonKey ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing Supabase configuration for user-scoped client.');
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
}

export function resetPlatformSupabase(): void {
  cached = null;
}
