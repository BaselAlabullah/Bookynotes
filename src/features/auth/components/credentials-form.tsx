"use client";

import Link from "next/link";
import { useActionState } from "react";

import { emptyFormState, type AuthFormState } from "../auth.schema";

type CredentialsFormProps = {
  /** A Server Function. Passing one as a prop is allowed and is what keeps this
   * component identical for sign-in and sign-up. */
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  submitLabel: string;
  alternative: { prompt: string; href: string; label: string };
  /**
   * Sign-up asks for a username; signing in does not. A boolean rather than two
   * components, because everything else about the two forms is identical and
   * duplicating them would mean fixing every future change twice.
   */
  withUsername?: boolean;
};

/**
 * The only interactive part of auth.
 *
 * `useActionState` wires the form directly to a Server Function: no fetch, no
 * JSON, no client-side state machine. If the JavaScript bundle never loads the
 * form still submits, because it is a real <form> with a real action.
 */
export function CredentialsForm({
  action,
  submitLabel,
  alternative,
  withUsername = false,
}: CredentialsFormProps) {
  const [state, formAction, isPending] = useActionState(action, emptyFormState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      {withUsername ? (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Username</span>
          <input
            name="username"
            type="text"
            autoComplete="username"
            required
            minLength={3}
            maxLength={24}
            // Mirrors the server rule in auth.schema.ts. The browser check is a
            // courtesy that fails fast; the Zod schema is what actually decides.
            pattern="[a-zA-Z][a-zA-Z0-9_]*"
            className="min-w-0 w-full border border-rule bg-paper-raised px-3 py-2.5 outline-none focus:border-accent"
          />
          <span className="text-xs text-ink-muted">
            Letters, digits and underscores. This is how you will be shown.
          </span>
        </label>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="min-w-0 w-full border border-rule bg-paper-raised px-3 py-2.5 outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Password</span>
        <input
          name="password"
          type="password"
          // "new-password" on sign-up would be more correct, but this component
          // serves both forms and the browser copes; splitting the component in
          // two for one attribute is not worth it.
          autoComplete="current-password"
          required
          minLength={8}
          className="min-w-0 w-full border border-rule bg-paper-raised px-3 py-2.5 outline-none focus:border-accent"
        />
      </label>

      {state.error ? (
        <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      {state.message ? (
        <p role="status" className="text-sm text-accent">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="bg-accent px-4 py-2.5 font-medium text-paper disabled:opacity-60"
      >
        {isPending ? "Working…" : submitLabel}
      </button>

      <p className="text-sm text-ink-muted">
        {alternative.prompt}{" "}
        <Link href={alternative.href} className="underline">
          {alternative.label}
        </Link>
      </p>
    </form>
  );
}
