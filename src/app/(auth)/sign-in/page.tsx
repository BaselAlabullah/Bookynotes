import type { Metadata } from "next";

import { signInAction } from "@/features/auth/auth.actions";
import { CredentialsForm } from "@/features/auth/components/credentials-form";

export const metadata: Metadata = { title: "Sign in · Marginalia" };

export default function SignInPage() {
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl">Sign in</h1>
        <p className="text-sm text-ink-muted">
          Your library and every note in it.
        </p>
      </header>

      <CredentialsForm
        action={signInAction}
        submitLabel="Sign in"
        alternative={{
          prompt: "No account yet?",
          href: "/sign-up",
          label: "Create one",
        }}
      />
    </>
  );
}
