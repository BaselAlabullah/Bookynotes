import type { Metadata } from "next";
import Link from "next/link";

import { requireUser } from "@/features/auth/auth.session";
import { listBooks } from "@/features/books/books.repository";
import { LibraryList } from "@/features/books/components/library-list";

export const metadata: Metadata = { title: "Library · Marginalia" };

/**
 * `requireUser()` is called here even though the layout already did, so the
 * page's guarantee does not depend on where it sits in the route tree. It also
 * produces the `UserId` that `listBooks` demands — there is no way to reach the
 * query without it.
 */
export default async function LibraryPage() {
  const user = await requireUser();
  const books = await listBooks(user.id);

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-serif text-3xl">Your library</h1>
        {books.length > 0 ? (
          <Link href="/library/add" className="text-sm underline">
            Add a book
          </Link>
        ) : null}
      </div>

      <LibraryList books={books} />
    </main>
  );
}
