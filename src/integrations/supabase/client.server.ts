import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

async function getEnv(key: string): Promise<string | undefined> {
  let value: string | undefined;

  // 1. Try vinxi event context (Cloudflare/Server)
  try {
    const { getEvent } = await import("vinxi/http");
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

async function createSupabaseAdminClient() {
  const url = await getEnv("SUPABASE_URL");
  const key = await getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    return null;
  }

  return createClient<Database>(url, key, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Note: Using a proxy with async initialization for the admin client
let _supabaseAdmin: any | undefined;

export const supabaseAdmin = new Proxy({} as any, {
  get(_, prop) {
    if (prop === "then") return undefined; // Avoid promise-like behavior if not intended

    // This is tricky for a synchronous proxy to handle an async client.
    // In practice, supabaseAdmin should probably be accessed via an async helper
    // or we should ensure it's initialized before use in server functions.

    // For now, we'll throw a helpful error if someone tries to use it synchronously
    // without it being ready, but ideally we'd use the getServerContext pattern.
    if (!_supabaseAdmin) {
      throw new Error("Supabase Admin client must be initialized asynchronously or accessed via getServerContext().");
    }
    return Reflect.get(_supabaseAdmin, prop);
  },
});

/**
 * Recommended way to get the admin client on the server.
 */
export async function getAdminClient() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = await createSupabaseAdminClient();
  }
  if (!_supabaseAdmin) {
    throw new Error("Supabase Admin client could not be initialized. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return _supabaseAdmin;
}
