import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createClient } from '@supabase/supabase-js'
import { getCookie, getEvent } from 'vinxi/http'
import type { Database } from './types'

function getEnv(key: string): string | undefined {
  const event = getEvent()
  const cloudflareEnv = (event?.context as any)?.cloudflare?.env || {}

  // Try direct key, then VITE_ prefixed key, across both Cloudflare and process.env
  return (
    cloudflareEnv[key] ||
    cloudflareEnv[`VITE_${key}`] ||
    process.env[key] ||
    process.env[`VITE_${key}`]
  )
}

export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const SUPABASE_URL = getEnv('SUPABASE_URL');
    const SUPABASE_PUBLISHABLE_KEY = getEnv('SUPABASE_PUBLISHABLE_KEY') || getEnv('SUPABASE_ANON_KEY');

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      const msg = `Missing Supabase config. Found URL: ${!!SUPABASE_URL}, Key: ${!!SUPABASE_PUBLISHABLE_KEY}`;
      console.error(`[Supabase Auth] ${msg}`);
      throw new Response(msg, { status: 500 });
    }
    
    const request = getRequest();
    let token = '';

    // 1. Try Authorization Header
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.replace('Bearer ', '');
    }

    // 2. Fallback to Cookie (for SSR/Direct Page Loads)
    if (!token) {
      try {
        const event = getEvent()
        token = getCookie(event, 'sb-access-token') || '';
      } catch (e) {
        // Not available
      }
    }

    if (!token) {
      throw new Response('Unauthorized: No token provided', { status: 401 });
    }

    const supabase = createClient<Database>(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      }
    );

    const { data: userData, error } = await supabase.auth.getUser(token);
    if (error || !userData.user) {
      throw new Response('Unauthorized: Invalid token', { status: 401 });
    }

    return next({
      context: {
        supabase,
        userId: userData.user.id,
        user: userData.user,
      },
    })
  }
)
