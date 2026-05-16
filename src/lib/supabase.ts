import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY: string;
  [key: string]: any;
}

/**
 * Creates a standard Supabase client using the Cloudflare environment object.
 */
export function getSupabase(env: Env): SupabaseClient<Database> {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

/**
 * Creates a Supabase Admin client (Service Role) using the Cloudflare environment object.
 * Warning: Only use this in server-side contexts.
 */
export function getSupabaseAdmin(env: Env): SupabaseClient<Database> {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}
