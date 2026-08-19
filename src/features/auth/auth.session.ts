import { redirect } from "next/navigation";

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
 * Uses `getUser()`, never `getSession()`. `getSession()` decodes the cookie and
 * believes it; `getUser()` sends the token to Supabase's auth server, which
 * verifies the signature and that the user still exists. The cookie is
 * attacker-supplied data, so trusting it unverified would be an authentication
 * bypass. The price is one network call per request, which is the correct
 * trade.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user?.email) {
    return null;
  }

  return { id: asUserId(data.user.id), email: data.user.email };
}

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
