import { z } from "zod";

/**
 * Validation for the two credential forms. Applied on the server inside the
 * Server Function, not in the browser: client-side checks are a convenience for
 * the user, never a guarantee for us.
 */
export const credentialsSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z
    .string()
    // Supabase's own default minimum is 6. Eight is not a meaningful security
    // difference on its own; it is here so the rule lives in our code where it
    // can be seen, rather than in a dashboard setting nobody reads.
    .min(8, "Password must be at least 8 characters."),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/**
 * What a credential Server Function hands back to the form.
 *
 * `message` exists for the one success case that is not a redirect: signing up
 * while email confirmation is enabled leaves you with no session and an email
 * to go and click.
 */
export type AuthFormState = {
  error: string | null;
  message: string | null;
};

export const emptyFormState: AuthFormState = { error: null, message: null };
