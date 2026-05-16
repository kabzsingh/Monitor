import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Robust environment variable resolver for Cloudflare Workers, Node.js, and Vite.
 * Uses SSR guard to prevent vinxi/http from being bundled on the client.
 */
async function getEnv(key: string): Promise<string | undefined> {
  if (!import.meta.env.SSR) {
    return (import.meta.env as any)[`VITE_${key}`];
  }

  try {
    const { getEvent } = await import("vinxi/http");
    const event = getEvent();
    const cloudflareEnv = (event?.context as any)?.cloudflare?.env || {};
    const processEnv = (globalThis as any).process?.env || {};

    return (
      cloudflareEnv[key] ||
      cloudflareEnv[`VITE_${key}`] ||
      processEnv[key] ||
      processEnv[`VITE_${key}`]
    );
  } catch (e) {
    const processEnv = (globalThis as any).process?.env || {};
    return processEnv[key] || processEnv[`VITE_${key}`];
  }
}

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    // These only run on the server
    const SUPABASE_URL = await getEnv("SUPABASE_URL");
    const SUPABASE_PUBLISHABLE_KEY =
      (await getEnv("SUPABASE_PUBLISHABLE_KEY")) || (await getEnv("SUPABASE_ANON_KEY"));

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      const msg = `Missing Supabase configuration. URL: ${!!SUPABASE_URL}, Key: ${!!SUPABASE_PUBLISHABLE_KEY}`;
      console.error(`[Supabase Auth] ${msg}`);
      throw new Response(msg, { status: 500 });
    }

    const request = getRequest();
    let token = "";

    // 1. Try Authorization Header
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.replace("Bearer ", "");
    }

    // 2. Fallback to Cookies (for SSR / direct page loads)
    if (!token) {
      try {
        const { getEvent, getCookie } = await import("vinxi/http");
        const event = getEvent();
        token = getCookie(event, "sb-access-token") || getCookie(event, "supabase-auth-token") || "";
      } catch (e) {
        // Not available in this context
      }
    }

    if (!token) {
      throw new Response("Unauthorized: No active session found", { status: 401 });
    }

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // Verify the token and get user data
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.warn("[Supabase Auth] Token verification failed:", error?.message);
      throw new Response("Unauthorized: Invalid or expired session", { status: 401 });
    }

    return next({
      context: {
        supabase,
        user,
        userId: user.id,
      },
    });
  },
);
