import Link from "next/link";

import { getCurrentUser } from "@/features/auth/auth.session";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
      <h1 className="font-serif text-4xl">Marginalia</h1>
      <p className="text-ink-muted">
        Photograph a page of a physical book, mark a passage, and keep the note
        with the words it belongs to.
      </p>

      <div className="flex gap-4">
        {user ? (
          <Link
            href="/library"
            className="rounded-md bg-accent px-4 py-2 font-medium text-paper"
          >
            Go to your library
          </Link>
        ) : (
          <>
            <Link
              href="/sign-up"
              className="rounded-md bg-accent px-4 py-2 font-medium text-paper"
            >
              Create an account
            </Link>
            <Link href="/sign-in" className="px-4 py-2 underline">
              Sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
