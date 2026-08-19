import type { Metadata } from "next";

import { signUpAction } from "@/features/auth/auth.actions";
import { CredentialsForm } from "@/features/auth/components/credentials-form";

export const metadata: Metadata = { title: "Sign up · Marginalia" };

export default function SignUpPage() {
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl">Create an account</h1>
        <p className="text-sm text-ink-muted">
          Eight characters or more for the password.
        </p>
      </header>

      <CredentialsForm
        action={signUpAction}
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
