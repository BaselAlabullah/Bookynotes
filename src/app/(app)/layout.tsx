import Image from "next/image";
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
  await requireUser();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[96rem] flex-col px-4 sm:px-6 lg:px-8">
      <header className="app-header border-b border-rule py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link
            href="/library"
            className="flex min-w-0 items-center gap-3"
            aria-label="Bookynotes library"
          >
            <span className="relative flex size-9 shrink-0 overflow-hidden">
              <Image
                src="/brand/bookynotes-icon-sketch.svg"
                alt=""
                width={400}
                height={400}
                priority
                className="size-full object-contain"
              />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-xs font-semibold uppercase tracking-[0.32em] text-ink">
                Bookynotes
              </span>
              <span className="hidden text-xs text-ink-muted md:block">
                Margins for physical books
              </span>
            </span>
          </Link>

          <nav
            aria-label="Primary"
            className="order-3 flex w-full items-center gap-5 border-t border-rule pt-3 text-xs uppercase tracking-[0.14em] text-ink-muted sm:order-none sm:w-auto sm:border-t-0 sm:pt-0"
          >
            <Link href="/library" className="transition-colors hover:text-ink">
              Library
            </Link>
            <Link href="/search" className="transition-colors hover:text-ink">
              Search
            </Link>
          </nav>

          <form
            action="/search"
            method="get"
            className="order-4 flex w-full sm:order-none sm:ml-auto sm:w-80 lg:w-96"
          >
            <label htmlFor="global-search" className="sr-only">
              Search annotations
            </label>
            <div className="flex w-full items-center border-b border-rule transition-colors focus-within:border-accent">
              <svg
                aria-hidden
                viewBox="0 0 20 20"
                className="size-4 shrink-0 fill-none stroke-current text-ink-muted"
                strokeWidth="1.6"
              >
                <circle cx="8.5" cy="8.5" r="5.5" />
                <path d="m12.5 12.5 4 4" />
              </svg>
              <input
                id="global-search"
                name="q"
                type="search"
                placeholder="Search notes"
                className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-ink-muted/75"
              />
              <kbd className="hidden pl-2 text-xs text-ink-muted sm:block">
                /
              </kbd>
            </div>
          </form>

          <div className="ml-auto flex items-center sm:ml-0">
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="flex-1 py-7 sm:py-10">{children}</div>
    </div>
  );
}
