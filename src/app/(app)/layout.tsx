import Link from "next/link";
import type { ReactNode } from "react";

import { requireUser } from "@/features/auth/auth.session";
import { findProfile } from "@/features/auth/profiles.repository";
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
  // The username if they have one, the email if they signed up before usernames
  // existed. Request-cached, so a page below can ask for it without a second
  // query.
  const profile = await findProfile(user.id);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[96rem] flex-col px-4 sm:px-6 lg:px-8">
      <header className="app-header flex min-h-20 flex-wrap items-center gap-x-6 gap-y-3 border-b border-ink py-3">
        <div className="flex items-baseline gap-5">
          <Link href="/library" className="text-xs font-semibold uppercase tracking-[0.22em]">
            Bookynotes
          </Link>
          <span aria-hidden className="hidden h-4 border-l border-rule sm:block" />
          <Link href="/library" className="hidden text-xs text-ink-muted hover:text-ink sm:block">
            Library
          </Link>
        </div>

        <form action="/search" method="get" className="order-3 flex w-full sm:order-none sm:ml-auto sm:w-72">
          <label htmlFor="global-search" className="sr-only">Search annotations</label>
          <div className="flex w-full items-center border-b border-rule focus-within:border-accent">
            <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0 fill-none stroke-current text-ink-muted" strokeWidth="1.5">
              <circle cx="8.5" cy="8.5" r="5.5" />
              <path d="m12.5 12.5 4 4" />
            </svg>
            <input id="global-search" name="q" type="search" placeholder="Search your notes" className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none" />
            <kbd className="text-[10px] text-ink-muted">/</kbd>
          </div>
        </form>

        <div className="ml-auto flex items-center gap-3 sm:ml-0">
          <span className="hidden max-w-44 truncate text-xs text-ink-muted lg:block">{profile?.username ?? user.email}</span>
          <SignOutButton />
        </div>
      </header>

      <div className="flex-1 py-7 sm:py-10">{children}</div>
    </div>
  );
}
