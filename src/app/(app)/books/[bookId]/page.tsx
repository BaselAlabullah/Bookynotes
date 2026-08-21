import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { asBookId } from "@/db/ids";
import { requireUser } from "@/features/auth/auth.session";
import { findBook } from "@/features/books/books.repository";
import { PageGrid } from "@/features/pages/components/page-grid";
import { PageUploader } from "@/features/pages/components/page-uploader";
import { listPagesForBook } from "@/features/pages/pages.repository";
import { signPageImages } from "@/features/pages/pages.images";
import { getPageDeletionImpacts } from "@/features/pages/pages.service";

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
  searchParams,
}: {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{ cleanup?: string }>;
}) {
  const user = await requireUser();
  const { bookId } = await params;
  const { cleanup } = await searchParams;

  // Independent of each other: both need only the user and the book id.
  const resolvedBookId = asBookId(bookId);
  const [book, pages] = await Promise.all([
    findBook(user.id, resolvedBookId),
    listPagesForBook(user.id, resolvedBookId),
  ]);

  if (!book) {
    // Covers both "no such book" and "not yours", which is deliberate.
    notFound();
  }

  // One request for every thumbnail on the page, and thumbnails rather than
  // the originals. See features/pages/pages.images.ts for the measurements
  // that made both of those necessary.
  const [{ thumbnails: previewUrls }, annotationCounts] = await Promise.all([
    signPageImages(pages),
    getPageDeletionImpacts(
      user.id,
      pages.map((page) => page.id),
    ),
  ]);
  const nextPageNumber =
    pages.length === 0
      ? 1
      : Math.max(...pages.map((page) => page.pageNumber)) + 1;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8">
      <Breadcrumbs items={[{ label: "Library", href: "/library" }, { label: book.title }]} />
      <header className="border-b border-rule pb-5">
        <p className="text-xs uppercase tracking-[0.16em] text-ink-muted">{book.author}</p>
        <h1 className="mt-1 max-w-[24ch] font-serif text-4xl leading-tight tracking-tight">{book.title}</h1>
      </header>

      {cleanup === "needed" ? (
        <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
          The page was deleted, but some stored files still need cleanup. Run the orphan sweep.
        </p>
      ) : null}

      <PageUploader
        key={nextPageNumber}
        bookId={book.id}
        nextPageNumber={nextPageNumber}
      />

      <PageGrid bookId={book.id} pages={pages} previewUrls={previewUrls} annotationCounts={annotationCounts} />
    </main>
  );
}
