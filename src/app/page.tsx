import Link from "next/link";

import { getCurrentUser } from "@/features/auth/auth.session";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[96rem] flex-col px-5 sm:px-8">
      <header className="flex h-20 items-center justify-between border-b border-ink">
        <p className="text-xs font-semibold uppercase tracking-[0.22em]">
          Bookynotes
        </p>
        <p className="hidden text-xs uppercase tracking-[0.14em] text-ink-muted sm:block">
          Notes for books made of paper
        </p>
      </header>

      <section className="grid flex-1 border-b border-ink lg:grid-cols-[1.35fr_0.65fr]">
        <div className="flex flex-col justify-between border-b border-rule py-10 lg:border-b-0 lg:border-r lg:pr-12 lg:py-16">
          <p className="text-xs uppercase tracking-[0.18em] text-accent">
            Read · Mark · Remember
          </p>
          <h1 className="my-16 max-w-[11ch] font-serif text-[clamp(4.5rem,11vw,10rem)] leading-[0.78] tracking-[-0.065em]">
            Keep the margin.
          </h1>
          <p className="max-w-[48ch] text-base leading-7 text-ink-muted sm:text-lg">
            Photograph a page, mark the words that stopped you, and keep your
            thought beside them. Every passage stays searchable.
          </p>
        </div>

        <div className="flex flex-col justify-between py-10 lg:pl-12 lg:py-16">
          <ol className="divide-y divide-rule border-y border-rule">
            <li className="grid grid-cols-[2rem_1fr] gap-4 py-5">
              <span className="font-serif text-sm text-accent">01</span>
              <span className="text-sm">Photograph the physical page.</span>
            </li>
            <li className="grid grid-cols-[2rem_1fr] gap-4 py-5">
              <span className="font-serif text-sm text-accent">02</span>
              <span className="text-sm">Draw around the passage.</span>
            </li>
            <li className="grid grid-cols-[2rem_1fr] gap-4 py-5">
              <span className="font-serif text-sm text-accent">03</span>
              <span className="text-sm">Find it again by any word.</span>
            </li>
          </ol>

          <div className="mt-14 flex flex-wrap items-center gap-5">
            <Link
              href={user ? "/library" : "/sign-up"}
              className="bg-accent px-5 py-3 text-sm font-semibold text-paper-raised"
            >
              {user ? "Open your library" : "Create your library"}
            </Link>
            {!user ? (
              <Link
                href="/sign-in"
                className="text-sm underline decoration-rule underline-offset-4 hover:decoration-ink"
              >
                Sign in
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <footer className="flex min-h-16 items-center justify-between gap-4 text-[10px] uppercase tracking-[0.14em] text-ink-muted">
        <span>Physical books, digital memory</span>
        <span>Built for attentive reading</span>
      </footer>
    </main>
  );
}
