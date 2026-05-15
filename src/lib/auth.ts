import { createServerFn } from '@tanstack/react-start'
import { getCookie, setCookie, deleteCookie } from 'vinxi/http'
import { supabase } from '@/integrations/supabase/client'

const TOKEN_COOKIE_NAME = 'sb-access-token'
const REFRESH_COOKIE_NAME = 'sb-refresh-token'

export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  const accessToken = getCookie(TOKEN_COOKIE_NAME)
  const refreshToken = getCookie(REFRESH_COOKIE_NAME)

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
    setCookie(TOKEN_COOKIE_NAME, data.accessToken, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 1 week
    })

    if (data.refreshToken) {
      setCookie(REFRESH_COOKIE_NAME, data.refreshToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days
      })
    }

    return { success: true }
  })

export const signOut = createServerFn({ method: 'POST' }).handler(async () => {
  deleteCookie(TOKEN_COOKIE_NAME, { path: '/' })
  deleteCookie(REFRESH_COOKIE_NAME, { path: '/' })
  return { success: true }
})
