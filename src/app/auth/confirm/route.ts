import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "@/features/auth/supabase-server";

/**
 * Where Supabase's confirmation emails land.
 *
 * This is only reached when email confirmation is enabled on the project. It
 * exchanges the one-time token in the link for a real session cookie, which is
 * why it must be a route handler: Server Components cannot write cookies.
 *
 * If you enable confirmation, Supabase's default email template will NOT point
 * here — it uses the implicit flow, which puts tokens in the URL fragment where
 * only the browser can see them. Change the template to:
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 */

// Parsed rather than cast. `type` arrives from a URL, so it is a string from a
// stranger until proven otherwise; `as EmailOtpType` would be a lie the
// compiler happily believes.
const confirmParamsSchema = z.object({
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
  const params = confirmParamsSchema.safeParse({
    token_hash: request.nextUrl.searchParams.get("token_hash"),
    type: request.nextUrl.searchParams.get("type"),
  });

  if (!params.success) {
    redirect("/sign-in?error=invalid-confirmation-link");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    type: params.data.type,
    token_hash: params.data.token_hash,
  });

  if (error) {
    // Expired or already-used links land here. Both are ordinary, not
    // exceptional: confirmation links are single use and time limited.
    redirect("/sign-in?error=confirmation-failed");
  }

  redirect("/library");
}
