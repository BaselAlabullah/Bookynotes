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
    <main className="grid min-h-dvh lg:grid-cols-[minmax(18rem,0.8fr)_1.2fr]">
      <aside className="relative hidden overflow-hidden border-r border-ink bg-paper-raised p-10 lg:flex lg:flex-col lg:justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.22em]">Bookynotes</p>
        <span aria-hidden className="absolute -left-8 top-1/2 -translate-y-1/2 font-serif text-[28rem] leading-none text-paper-deep">M</span>
        <p className="relative max-w-[24ch] font-serif text-4xl leading-tight">Keep the thought beside the words that prompted it.</p>
        <p className="relative text-xs uppercase tracking-[0.14em] text-ink-muted">Annotation for physical books</p>
      </aside>
      <div className="mx-auto flex min-w-0 w-[calc(100%_-_3rem)] max-w-md flex-col justify-center gap-8 py-12 sm:w-full sm:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] lg:hidden">Bookynotes</p>
        {children}
      </div>
    </main>
  );
}
