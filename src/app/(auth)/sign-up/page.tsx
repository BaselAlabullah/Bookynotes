import type { Metadata } from "next";

import { signUpAction } from "@/features/auth/auth.actions";
import { CredentialsForm } from "@/features/auth/components/credentials-form";

export const metadata: Metadata = { title: "Sign up · Bookynotes" };

export default function SignUpPage() {
  return (
    <>
      <header className="flex flex-col items-center gap-2 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-accent">
          New shelf
        </p>
        <h1 className="font-serif text-3xl">Create your library</h1>
        <p className="text-sm text-ink-muted">
          A quiet place for the lines you refuse to forget.
        </p>
      </header>

      <CredentialsForm
        action={signUpAction}
        withUsername
        submitLabel="Create account"
        alternative={{
          prompt: "Already have an account?",
          href: "/sign-in",
          label: "Sign in",
        }}
      />
    </>
  );
}
