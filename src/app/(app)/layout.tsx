import Link from "next/link";
import type { ReactNode } from "react";

import { requireUser } from "@/features/auth/auth.session";
import { SignOutButton } from "@/features/auth/components/sign-out-button";

/**
 * Everything inside the (app) route group requires a session.
 *
 * This layout is the convenient place to enforce that, but it is not the only
 * place it is enforced — see the note in auth.session.ts. Pages and Server
 * Functions below call `requireUser()` themselves rather than assuming a parent
 * layout ran.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-8 px-6 py-8">
      <header className="flex items-center justify-between gap-4 border-b border-ink-muted/20 pb-4">
        <Link href="/library" className="font-serif text-xl">
          Marginalia
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-muted">{user.email}</span>
          <SignOutButton />
        </div>
      </header>

      {children}
    </div>
  );
}
