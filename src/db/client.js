import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Ensure WebSocket constructor exists in Node <22 runtimes for Supabase client
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class WebSocket {};
}

let supabaseInstance = null;

export function getSupabaseClient() {
  if (supabaseInstance) return supabaseInstance;

  if (!config.supabase.url || !config.supabase.serviceKey || config.supabase.url.includes('mock')) {
    logger.warn('Supabase URL/Key missing or set to mock. Using mock client placeholder.');
    return createMockSupabase();
  }

  supabaseInstance = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false },
  });

  return supabaseInstance;
}

function createMockSupabase() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: null, error: null }), data: [], error: null }),
        in: async () => ({ data: [], error: null }),
        is: async () => ({ data: [], error: null }),
        lte: async () => ({ data: [], error: null }),
        limit: async () => ({ data: [], error: null }),
      }),
      insert: async () => ({ data: [], error: null }),
      update: async () => ({ data: [], error: null }),
      upsert: async () => ({ data: [], error: null }),
    }),
  };
}
