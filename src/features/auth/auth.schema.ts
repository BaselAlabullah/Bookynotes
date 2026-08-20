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
 * Names the app itself uses, or might. A username that collides with a route or
 * an identity like "admin" is a small confusion that is very hard to undo once
 * someone owns it, and reserving them costs nothing now.
 */
const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "system", "support", "help", "about",
  "api", "auth", "signin", "sign-in", "signup", "sign-up", "signout",
  "library", "books", "book", "pages", "page", "search", "annotations",
  "settings", "account", "profile", "me", "new", "bookynotes",
]);

/**
 * A username.
 *
 * Deliberately narrow. It has to be typed, said aloud, and possibly put in a
 * URL one day, so it allows letters, digits and underscores only — no spaces,
 * no punctuation, no unicode lookalikes that let one person impersonate
 * another. Capitalisation is preserved as typed; uniqueness ignores it.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Usernames are at least 3 characters.")
  .max(24, "Usernames are at most 24 characters.")
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]*$/,
    "Use letters, digits and underscores, starting with a letter.",
  )
  .refine(
    (value) => !RESERVED_USERNAMES.has(value.toLowerCase()),
    "That username is reserved.",
  );

/** Sign-up needs a username as well; signing in does not. */
export const signUpSchema = credentialsSchema.extend({
  username: usernameSchema,
});


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
