import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicEnv } from "@/config/env.public";

import { hardenSessionCookie } from "./session-cookie";

/**
 * A Supabase client bound to the current request's cookies.
 *
 * Supabase keeps the session in cookies rather than localStorage precisely so
 * that the server can read it. This factory wires its cookie store to Next's,
 * so a token refreshed on the server is written back to the browser.
 *
 * Create one per request. Never hoist it to a module-level constant: it closes
 * over one user's cookies, and a shared instance on a serverless function would
 * hand that session to whoever the next request belongs to.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, hardenSessionCookie(options));
            }
          } catch {
            // Server Components are not allowed to write cookies, and Supabase
            // will try whenever it silently refreshes an expiring token. That is
            // safe to swallow here *because* src/proxy.ts performs the same
            // refresh on every request and can write the result. Without the
            // proxy, this catch would quietly sign users out after an hour.
          }
        },
      },
    },
  );
}
