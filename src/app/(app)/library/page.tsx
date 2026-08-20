import type { Metadata } from "next";
import Link from "next/link";

import { requireUser } from "@/features/auth/auth.session";
import { signBookCovers } from "@/features/books/books.cover";
import { listBooks } from "@/features/books/books.repository";
import { LibraryList } from "@/features/books/components/library-list";
import { getBookDeletionImpacts } from "@/features/books/books.service";

export const metadata: Metadata = { title: "Library · Bookynotes" };

/**
 * `requireUser()` is called here even though the layout already did, so the
 * page's guarantee does not depend on where it sits in the route tree. It also
 * produces the `UserId` that `listBooks` demands — there is no way to reach the
 * query without it.
 */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ cleanup?: string }>;
}) {
  const user = await requireUser();
  const books = await listBooks(user.id);
  const { cleanup } = await searchParams;
  // One batched, cached signing request for every cover we hold our own copy
  // of. Books added before that existed fall back to Open Library's URL.
  const [coverUrls, deletionImpacts] = await Promise.all([
    signBookCovers(books),
    getBookDeletionImpacts(
      user.id,
      books.map((book) => book.id),
    ),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8">
      <header className="flex items-end justify-between gap-4 border-b border-rule pb-5">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-ink-muted">Collection</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight">Your library</h1>
        </div>
        {books.length > 0 ? (
          <Link href="/library/add" className="bg-accent px-4 py-2 text-sm font-medium text-paper">
            Add a book
          </Link>
        ) : null}
      </header>

      {cleanup === "needed" ? (
        <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
          The library entry was deleted, but some stored files still need cleanup. Run the orphan sweep.
        </p>
      ) : null}

      <LibraryList books={books} coverUrls={coverUrls} deletionImpacts={deletionImpacts} />
    </main>
  );
}
