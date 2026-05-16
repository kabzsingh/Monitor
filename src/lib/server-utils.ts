import { type Env, getSupabase, getSupabaseAdmin } from "./supabase";

/**
 * Utility to get Cloudflare Env, Supabase clients, and Vinxi helpers inside createServerFn.
 * Dynamically imports 'vinxi/http' to prevent client-side bundling issues.
 */
export async function getServerContext() {
  if (!import.meta.env.SSR) {
    throw new Error("getServerContext can only be called on the server.");
  }

  const vinxiHttp = await import("vinxi/http");
  const event = vinxiHttp.getEvent();
  const env = (event?.context as any)?.cloudflare?.env as Env;

  // Fallback for local development if env is missing in context
  const effectiveEnv = env || (process.env as unknown as Env);

  return {
    env: effectiveEnv,
    supabase: getSupabase(effectiveEnv),
    supabaseAdmin: getSupabaseAdmin(effectiveEnv),
    event,
    getCookie: vinxiHttp.getCookie,
    setCookie: vinxiHttp.setCookie,
    deleteCookie: vinxiHttp.deleteCookie,
  };
}
