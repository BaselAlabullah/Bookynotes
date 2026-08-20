import type { Metadata } from "next";
import Link from "next/link";

import { requireUser } from "@/features/auth/auth.session";
import { BookSearch } from "@/features/books/components/book-search";

export const metadata: Metadata = { title: "Add a book · Marginalia" };

export default async function AddBookPage() {
  // The search itself is authenticated by its route handler, but the page is
  // guarded here too: an unauthenticated visitor should get a redirect, not an
  // empty search box that fails on first use.
  await requireUser();

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-serif text-3xl">Add a book</h1>
        <Link href="/library" className="text-sm underline">
          Back to library
        </Link>
      </div>

      <BookSearch />
    </main>
  );
}
