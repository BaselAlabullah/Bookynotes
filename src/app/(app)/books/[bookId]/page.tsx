import { notFound } from "next/navigation";
import Link from "next/link";

import { asBookId } from "@/db/ids";
import { requireUser } from "@/features/auth/auth.session";
import { findBook } from "@/features/books/books.repository";
import { PageGrid } from "@/features/pages/components/page-grid";
import { PageUploader } from "@/features/pages/components/page-uploader";
import { listPagesForBook } from "@/features/pages/pages.repository";
import { createSignedRead } from "@/integrations/storage/storage.client";

/**
 * One book: its pages, and the uploader for adding another.
 *
 * Read URLs are signed here, on the server, one per page. They are short lived
 * by design — see `integrations/storage`. Signing them at render time rather
 * than storing them is what keeps the bucket private: there is no durable URL
 * anywhere that would still work if it leaked.
 */
export default async function BookPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const user = await requireUser();
  const { bookId } = await params;

  const book = await findBook(user.id, asBookId(bookId));

  if (!book) {
    // Covers both "no such book" and "not yours", which is deliberate.
    notFound();
  }

  const pages = await listPagesForBook(user.id, book.id);

  // Signed in parallel: with a dozen pages, doing this in sequence would add a
  // dozen round trips to Supabase before the first byte of HTML.
  const signed = await Promise.all(
    pages.map(async (page) => {
      try {
        const read = await createSignedRead(page.storageKey);
        return [page.id, read.url] as const;
      } catch {
        // One unreadable object should cost one thumbnail, not the whole page.
        return null;
      }
    }),
  );

  const previewUrls = new Map(
    signed.filter((entry) => entry !== null),
  );

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/library" className="text-sm underline">
          Back to library
        </Link>
        <h1 className="font-serif text-3xl">{book.title}</h1>
        <p className="text-ink-muted">{book.author}</p>
      </div>

      <PageUploader bookId={book.id} />

      <PageGrid bookId={book.id} pages={pages} previewUrls={previewUrls} />
    </main>
  );
}
