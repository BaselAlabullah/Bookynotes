import type { Metadata } from "next";

import { signInAction } from "@/features/auth/auth.actions";
import { confirmationErrorMessage } from "@/features/auth/auth.errors";
import { CredentialsForm } from "@/features/auth/components/credentials-form";

export const metadata: Metadata = { title: "Sign in · Marginalia" };

/**
 * `searchParams` is a promise in Next 16, because the page can begin rendering
 * before the request's query string is needed.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const confirmationError = confirmationErrorMessage(error);

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl">Sign in</h1>
        <p className="text-sm text-ink-muted">
          Your library and every note in it.
        </p>
      </header>

      {confirmationError ? (
        <p
          role="alert"
          className="border-l-2 border-danger pl-3 text-sm text-danger"
        >
          {confirmationError}
        </p>
      ) : null}

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
