import { createClient } from '@supabase/supabase-js';
import { getEvent } from 'vinxi/http';
import type { Database } from './types';

function getEnv(key: string): string | undefined {
  let value: string | undefined;

  // 1. Try vinxi event context (Cloudflare/Server)
  try {
    const event = getEvent();
    const cloudflareEnv = (event?.context as any)?.cloudflare?.env;
    value = cloudflareEnv?.[key] || cloudflareEnv?.[`VITE_${key}`];
  } catch {}

  // 2. Try process.env (Node/Build)
  if (!value) {
    const env = (globalThis as any).process?.env || {};
    value = env[key] || env[`VITE_${key}`];
  }

  return value;
}

function createSupabaseAdminClient() {
  const url = getEnv('SUPABASE_URL');
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !key) {
    return null;
  }

  return createClient<Database>(url, key, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    }
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

export const supabaseAdmin = new Proxy({} as Exclude<ReturnType<typeof createSupabaseAdminClient>, null>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    if (!_supabaseAdmin) {
      throw new Error("Supabase Admin client could not be initialized. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    }
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});
