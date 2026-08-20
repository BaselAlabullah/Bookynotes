import type { Metadata } from "next";

import { requireUser } from "@/features/auth/auth.session";
import { BookSearch } from "@/features/books/components/book-search";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export const metadata: Metadata = { title: "Add a book · Marginalia" };

export default async function AddBookPage() {
  // The search itself is authenticated by its route handler, but the page is
  // guarded here too: an unauthenticated visitor should get a redirect, not an
  // empty search box that fails on first use.
  await requireUser();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <Breadcrumbs items={[{ label: "Library", href: "/library" }, { label: "Add a book" }]} />
      <header className="border-b border-rule pb-5">
        <p className="text-xs uppercase tracking-[0.16em] text-ink-muted">Collection</p>
        <h1 className="mt-1 font-serif text-4xl tracking-tight">Add a book</h1>
        <p className="mt-2 max-w-[58ch] text-sm leading-6 text-ink-muted">Find the title you are reading. You can add photographed pages once it is on your shelf.</p>
      </header>

      <BookSearch />
    </main>
  );
}
