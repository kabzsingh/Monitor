import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function getEnv(key: string): string | undefined {
  // 1. Browser/Vite check
  if (typeof window !== "undefined") {
    return (import.meta.env as any)[`VITE_${key}`];
  }

  // 2. Server-side check (using global process/env)
  // We avoid importing 'vinxi/http' here to prevent client-side bundling issues.
  const processEnv = (globalThis as any).process?.env || {};
  return (
    processEnv[key] ||
    processEnv[`VITE_${key}`]
  );
}

function createSupabaseClient() {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_PUBLISHABLE_KEY") || getEnv("SUPABASE_ANON_KEY");

  if (!url || !key) {
    return null;
  }

  return createClient<Database>(url, key, {
    auth: {
      storage: typeof window !== "undefined" ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase = new Proxy({} as Exclude<ReturnType<typeof createSupabaseClient>, null>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    if (!_supabase) {
      throw new Error(
        "Supabase client could not be initialized. Ensure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are set in your environment.",
      );
    }
    return Reflect.get(_supabase, prop, receiver);
  },
});
