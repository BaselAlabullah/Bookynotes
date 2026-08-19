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

  // This call is the entire point: it validates the token and, when it is close
  // to expiry, triggers the refresh that `setAll` above writes back. The result
  // is intentionally discarded — decisions are made in `requireUser()`.
  await supabase.auth.getUser();

  return response;
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
