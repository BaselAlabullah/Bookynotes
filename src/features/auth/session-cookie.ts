import type { CookieOptions } from "@supabase/ssr";

/**
 * Extra restrictions applied to every session cookie we write.
 *
 * `@supabase/ssr` deliberately leaves the auth cookie readable by JavaScript,
 * because its browser client reads the session from there. This app has no
 * browser client: every call to Supabase Auth happens in a Server Function or
 * route handler. So the cookie is marked httpOnly, and a cross-site scripting
 * bug can no longer read the access and refresh tokens out of `document.cookie`.
 *
 * The consequence, stated plainly because it will bite whoever forgets: calling
 * `createBrowserClient()` anywhere in this app will not see a session. If a
 * later phase genuinely needs one, this is the file to change, and the change
 * is a real security trade-off rather than a config tweak.
 *
 * `sameSite: "lax"` keeps the cookie off cross-site POSTs, which is the CSRF
 * property that matters given our Server Functions are POSTs.
 */
export function hardenSessionCookie(options: CookieOptions): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    sameSite: "lax",
    // Send only over TLS in production. Note that `next start` also sets
    // NODE_ENV=production, so a local production build marks the cookie Secure
    // over plain http — that works because browsers treat localhost as a
    // trustworthy origin. `next dev` leaves it off.
    secure: process.env.NODE_ENV === "production",
  };
}
