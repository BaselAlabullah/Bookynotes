import { redirect } from "next/navigation";
import { cache } from "react";

import { asUserId, type UserId } from "@/db/ids";

import { createSupabaseServerClient } from "./supabase-server";

/**
 * The boundary where an untrusted cookie becomes a trusted `UserId`.
 *
 * Everything downstream — every repository function in the app — demands a
 * branded `UserId`, and this module is the only place one is minted. That is
 * what makes "did we check who this is?" impossible to forget: you cannot query
 * anything without a value that only these two functions can produce.
 */

export type CurrentUser = {
  id: UserId;
  email: string;
};

/**
 * The signed-in user, or null.
 *
 * Verification is **local and cryptographic**: `getClaims()` checks the access
 * token's ES256 signature against the project's published JWKS, and checks its
 * expiry. A tampered token is rejected — that was tested, not assumed.
 *
 * This refines DECISIONS 0015 rather than reversing it. The rule that mattered
 * there was *verify, never merely decode*: `getSession()` reads the cookie and
 * believes it, which is an authentication bypass. `getClaims()` proves the
 * token was issued by Supabase and has not been altered. Measured, that is 1ms
 * against 284ms for a round trip to the auth server, on every protected page.
 *
 * The cost, stated plainly because it is the whole trade: local verification
 * cannot know that a user was deleted or a session revoked *since* the token
 * was issued. An access token lives one hour, so that is the staleness window.
 * For this app there is no ban flow and no "sign out everywhere", and a deleted
 * user's rows are gone by cascade, so a stale token buys an attacker an empty
 * library. An app with real revocation requirements should pay the 284ms.
 *
 * If a project has not enabled asymmetric signing keys, `getClaims()` cannot
 * verify locally — so the remote check is kept as a fallback rather than
 * failing.
 *
 * Wrapped in React's `cache()`, which deduplicates it **within a single render
 * pass**. A protected route calls this at least twice — once in the layout and
 * again in the page, deliberately, so the page's guarantee does not depend on
 * its position in the tree (DECISIONS 0016). Without the wrapper that honesty
 * cost a second round trip to Supabase; measured from here, each one is about
 * 290ms. Now the checks are still independent in the code and share one answer
 * at runtime.
 *
 * The cache is per-request. It is not a session cache: a second request, from
 * anyone, verifies again.
 */
export const getCurrentUser = cache(
  async (): Promise<CurrentUser | null> => {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.auth.getClaims();

    if (!error && data?.claims) {
      const { sub, email } = data.claims;

      if (typeof sub === "string" && typeof email === "string") {
        return { id: asUserId(sub), email };
      }
    }

    // Fallback: the project may not have asymmetric signing keys, in which case
    // the claims cannot be checked here and the auth server has to be asked.
    // Slower, and correct.
    const { data: remote, error: remoteError } = await supabase.auth.getUser();

    if (remoteError || !remote.user?.email) {
      return null;
    }

    return { id: asUserId(remote.user.id), email: remote.user.email };
  },
);

/**
 * The signed-in user, or a redirect to sign-in.
 *
 * Call this at the top of every protected page, layout and Server Function.
 * Not only in the layout: Next's own documentation warns that Server Functions
 * are POSTs to whatever route they were called from, so a proxy matcher change
 * or a moved component can silently drop them out of a protected path.
 * Authorization belongs next to the data access, not in a routing rule.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  return user;
}
