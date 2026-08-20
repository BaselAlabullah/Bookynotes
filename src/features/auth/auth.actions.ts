"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { publicEnv } from "@/config/env.public";
import { isUniqueViolation } from "@/db/errors";
import { asUserId } from "@/db/ids";

import {
  credentialsSchema,
  signUpSchema,
  type AuthFormState,
} from "./auth.schema";
import { createProfile, isUsernameTaken } from "./profiles.repository";
import { createSupabaseServerClient } from "./supabase-server";

/**
 * Sign up, sign in and sign out as Server Functions.
 *
 * These are used instead of route handlers plus client-side fetch because the
 * form posts directly to them: no fetch call, no JSON round trip, and the forms
 * still work if the JavaScript bundle fails to load. The trade-off is that they
 * are invoked as POSTs to whatever route rendered the form, which is why each
 * one re-validates its own input rather than trusting anything upstream.
 */

function readCredentials(formData: FormData) {
  return credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
}

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    username: formData.get("username"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details.", message: null };
  }

  // Checked before the account is created, so that the overwhelmingly common
  // case — someone picking a name that is already gone — is a message next to
  // the field rather than an account that exists with no profile attached.
  // It is not the guarantee; the unique index is, and losing that race is
  // handled below.
  if (await isUsernameTaken(parsed.data.username)) {
    return { error: "That username is already taken.", message: null };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Where the confirmation link lands when email confirmation is enabled.
      emailRedirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/confirm`,
    },
  });

  if (error) {
    return { error: error.message, message: null };
  }

  if (!data.user) {
    return { error: "That account could not be created.", message: null };
  }

  // The profile is written straight after the account, in the same request.
  //
  // These two writes are not in one transaction and cannot be: the account
  // lives in Supabase Auth and the profile lives in our database. So the order
  // is chosen for which orphan is survivable — an account without a profile can
  // be given one later, whereas a profile without an account is a row pointing
  // at nobody, and the foreign key would refuse it anyway.
  try {
    await createProfile(asUserId(data.user.id), parsed.data.username);
  } catch (cause) {
    if (isUniqueViolation(cause)) {
      // Someone took the name between the check above and this insert. Rare,
      // and worth handling precisely rather than as a generic failure.
      return {
        error: "That username was taken a moment ago. Try another.",
        message: null,
      };
    }

    throw cause;
  }

  // The branch that decides itself rather than reading a config value we cannot
  // see: with email confirmation off, Supabase returns a session and the user is
  // already signed in. With it on, there is no session and an email is waiting.
  if (!data.session) {
    return {
      error: null,
      message: "Check your email for a confirmation link, then sign in.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/library");
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = readCredentials(formData);

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details.", message: null };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately Supabase's own wording ("Invalid login credentials"), which
    // does not reveal whether the email exists. Do not "improve" this into
    // "no account with that email".
    return { error: error.message, message: null };
  }

  revalidatePath("/", "layout");
  redirect("/library");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/sign-in");
}
