import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "@/features/auth/supabase-server";

/**
 * Where Supabase's confirmation emails land.
 *
 * There are two ways a user can arrive here, because there are two email
 * template styles, and a project can be using either:
 *
 * 1. `?code=...` — Supabase's DEFAULT template. The link goes to Supabase's own
 *    /auth/v1/verify endpoint, which confirms the account and then redirects
 *    here with a PKCE authorization code to exchange for a session.
 *
 * 2. `?token_hash=...&type=...` — a customised template that skips Supabase's
 *    redirect and hands us the one-time token directly:
 *
 *      {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 *
 * Both are handled, because which one applies depends on a dashboard setting
 * this code cannot see. Either way this must be a route handler and not a
 * Server Component: it writes a session cookie, and Server Components cannot.
 */

// Parsed, not cast. These arrive from a URL, so they are strings from a stranger
// until proven otherwise; `as EmailOtpType` would be a lie the compiler believes.
const tokenHashParamsSchema = z.object({
  token_hash: z.string().min(1),
  type: z.enum([
    "signup",
    "invite",
    "magiclink",
    "recovery",
    "email_change",
    "email",
  ]),
});

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      // The most common cause is not an expired link: PKCE stores a code
      // verifier in a cookie when sign-up happens, so opening the email in a
      // different browser or device leaves nothing to verify against. That case
      // gets its own message because "expired" would send the user in circles.
      redirect(
        error.message.toLowerCase().includes("code verifier")
          ? "/sign-in?error=confirmation-wrong-browser"
          : "/sign-in?error=confirmation-failed",
      );
    }

    redirect("/library");
  }

  const parsed = tokenHashParamsSchema.safeParse({
    token_hash: params.get("token_hash"),
    type: params.get("type"),
  });

  if (!parsed.success) {
    redirect("/sign-in?error=invalid-confirmation-link");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    type: parsed.data.type,
    token_hash: parsed.data.token_hash,
  });

  if (error) {
    // Expired or already-used links land here. Both are ordinary, not
    // exceptional: confirmation links are single use and time limited.
    redirect("/sign-in?error=confirmation-failed");
  }

  redirect("/library");
}
