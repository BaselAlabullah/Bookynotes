import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/features/auth/auth.session";

/**
 * Wraps the two credential pages. Signed-in users have no business here, so
 * they are sent to their library rather than shown a sign-in form that would
 * confuse them about whether they are logged in.
 */
export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();

  if (user) {
    redirect("/library");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-12 sm:px-8">
      <section className="w-full max-w-md">
        <Link
          href="/"
          aria-label="Bookynotes home"
          className="mx-auto mb-1 block w-80 max-w-full sm:w-96"
        >
          <Image
            src="/brand/bookynotes-logo-sketch.svg"
            alt="Bookynotes"
            width={1800}
            height={600}
            priority
            className="h-auto w-full"
          />
        </Link>

        <div className="border-y border-rule bg-paper/60 py-8">
          {children}
        </div>
      </section>
    </main>
  );
}
