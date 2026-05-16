import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie, deleteCookie, getEvent } from 'vinxi/http'
import { supabase } from '@/integrations/supabase/client'

const TOKEN_COOKIE_NAME = 'sb-access-token'
const REFRESH_COOKIE_NAME = 'sb-refresh-token'

/**
 * Robust environment variable resolver for Cloudflare Workers, Node.js, and Vite.
 */
function getEnv(key: string): string | undefined {
  try {
    const event = getEvent()
    const cloudflareEnv = (event?.context as any)?.cloudflare?.env || {}
    const processEnv = (globalThis as any).process?.env || {}

    return (
      cloudflareEnv[key] ||
      cloudflareEnv[`VITE_${key}`] ||
      processEnv[key] ||
      processEnv[`VITE_${key}`]
    )
  } catch (e) {
    const processEnv = (globalThis as any).process?.env || {}
    return processEnv[key] || processEnv[`VITE_${key}`]
  }
}

export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  const event = getEvent()
  const accessToken = getCookie(event, TOKEN_COOKIE_NAME)
  const refreshToken = getCookie(event, REFRESH_COOKIE_NAME)

  if (!accessToken) {
    return { session: null }
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken || '',
  })

  if (error || !data.session) {
    return { session: null }
  }

  return { session: data.session }
})

export const signIn = createServerFn({ method: 'POST' })
  .validator((d: { accessToken: string; refreshToken: string }) => d)
  .handler(async ({ data }) => {
    const event = getEvent()
    const isProd = getEnv('NODE_ENV') === 'production'

    setCookie(event, TOKEN_COOKIE_NAME, data.accessToken, {
      path: '/',
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 1 week
    })

    if (data.refreshToken) {
      setCookie(event, REFRESH_COOKIE_NAME, data.refreshToken, {
        path: '/',
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days
      })
    }

    return { success: true }
  })

export const signOut = createServerFn({ method: 'POST' }).handler(async () => {
  const event = getEvent()
  deleteCookie(event, TOKEN_COOKIE_NAME, { path: '/' })
  deleteCookie(event, REFRESH_COOKIE_NAME, { path: '/' })
  return { success: true }
})
