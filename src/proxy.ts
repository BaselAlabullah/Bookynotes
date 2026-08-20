import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/config/env.public";
import { hardenSessionCookie } from "@/features/auth/session-cookie";

/**
 * Runs before every matched request. In Next 16 this file was called
 * `middleware.ts`; the convention was renamed to `proxy` to discourage treating
 * it as an application layer, which is exactly the mistake this file avoids.
 *
 * Its ONLY job is to refresh the Supabase session cookie. Access tokens expire
 * after an hour, and Server Components cannot write cookies, so without a
 * refresh here every user would be signed out mid-session with no explanation.
 *
 * It does that lazily — see `refreshIfExpiringSoon` below. Refreshing on every
 * request means a Supabase round trip per navigation to do nothing.
 *
 * It is deliberately NOT the authorization mechanism. Next's own documentation
 * warns that Server Functions are POSTs to whichever route rendered them, so a
 * matcher edit or a moved component can silently remove a route from this
 * file's coverage. Protection lives in `requireUser()`, called next to the data
 * access it guards. This file is a convenience; that one is the rule.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write refreshed cookies onto both the request (so anything later in
          // this same request sees the new token) and the response (so the
          // browser stores it).
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({ request });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, hardenSessionCookie(options));
          }
        },
      },
    },
  );

  await refreshIfExpiringSoon(supabase);

  return response;
}

/**
 * Refresh the session only when it is actually close to expiring.
 *
 * The obvious implementation calls `getUser()` here on every request, which
 * refreshes the token as a side effect. It also costs a round trip to Supabase
 * on every navigation — measured at about 290ms — to do nothing at all for the
 * fifty-nine minutes of an hour when the token is perfectly fresh.
 *
 * So the expiry is read locally first. `getSession()` reads the cookie without
 * verifying it, which DECISIONS 0015 forbids for authorization — and this is
 * not authorization. Nothing here decides who the caller is or what they may
 * see; it decides only whether a refresh is due. Every actual authorization
 * decision still goes through `requireUser()` and a verified `getUser()`, which
 * is exactly the split DECISIONS 0016 draws between this file and that one.
 *
 * If a caller forged a session cookie with a distant expiry, the only thing
 * they would achieve is skipping a refresh they had no valid token to refresh.
 */
const REFRESH_WINDOW_SECONDS = 5 * 60;

async function refreshIfExpiringSoon(
  supabase: ReturnType<typeof createServerClient>,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  // No session at all: an anonymous request, and there is nothing to refresh.
  // This is the common case for the landing and sign-in pages.
  if (!session?.expires_at) {
    return;
  }

  const secondsRemaining = session.expires_at - Math.floor(Date.now() / 1000);

  if (secondsRemaining > REFRESH_WINDOW_SECONDS) {
    return;
  }

  // Due for renewal. `refreshSession` writes the new tokens through `setAll`
  // above, onto both the request and the response.
  await supabase.auth.refreshSession();
}

export const config = {
  matcher: [
    /*
     * Every path except Next's own static output and metadata files. Without a
     * matcher this would run on every CSS file and image, adding a network call
     * to Supabase for each one.
     *
     * `/api` is deliberately NOT excluded: route handlers read the session too,
     * and they need the same fresh cookie.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
