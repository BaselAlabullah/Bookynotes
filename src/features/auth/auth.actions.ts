"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { publicEnv } from "@/config/env.public";

import {
  credentialsSchema,
  type AuthFormState,
} from "./auth.schema";
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
  const parsed = readCredentials(formData);

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details.", message: null };
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
