import { createServerFn } from "@tanstack/react-start";
import { getServerContext } from "./server-utils";

const TOKEN_COOKIE_NAME = "sb-access-token";
const REFRESH_COOKIE_NAME = "sb-refresh-token";

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const { supabase, event, getCookie } = await getServerContext();

  const accessToken = getCookie(event, TOKEN_COOKIE_NAME);
  const refreshToken = getCookie(event, REFRESH_COOKIE_NAME);

  if (!accessToken) {
    return { session: null };
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken || "",
  });

  if (error || !data.session) {
    return { session: null };
  }

  return { session: data.session };
});

export const signIn = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; refreshToken: string }) => d)
  .handler(async ({ data }) => {
    const { env, event, setCookie } = await getServerContext();

    const isProd = env?.NODE_ENV === "production" || process.env.NODE_ENV === "production";

    setCookie(event, TOKEN_COOKIE_NAME, data.accessToken, {
      path: "/",
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 1 week
    });

    if (data.refreshToken) {
      setCookie(event, REFRESH_COOKIE_NAME, data.refreshToken, {
        path: "/",
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
    }

    return { success: true };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const { event, deleteCookie } = await getServerContext();
  deleteCookie(event, TOKEN_COOKIE_NAME, { path: "/" });
  deleteCookie(event, REFRESH_COOKIE_NAME, { path: "/" });
  return { success: true };
});
