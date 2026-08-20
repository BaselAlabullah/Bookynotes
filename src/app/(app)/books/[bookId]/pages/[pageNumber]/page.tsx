import Link from "next/link";
import { notFound } from "next/navigation";

import { asBookId } from "@/db/ids";
import { listAnnotationsForPage } from "@/features/annotations/annotations.repository";
import { PageAnnotator } from "@/features/annotations/components/page-annotator";
import { requireUser } from "@/features/auth/auth.session";
import { findBook } from "@/features/books/books.repository";
import { listPagesForBook } from "@/features/pages/pages.repository";
import { createSignedRead } from "@/integrations/storage/storage.client";

/**
 * A single page and its annotations.
 *
 * Everything below the fetch is normalized: the annotator receives coordinates
 * as fractions and the image's intrinsic dimensions, and never learns how large
 * the image is being displayed. That is what lets the same row render correctly
 * on a phone, on a laptop, and at 3x zoom.
 */
export default async function PageView({
  params,
}: {
  params: Promise<{ bookId: string; pageNumber: string }>;
}) {
  const user = await requireUser();
  const { bookId, pageNumber } = await params;

  const book = await findBook(user.id, asBookId(bookId));

  if (!book) {
    notFound();
  }

  // Page numbers are unique within a book, so the number in the URL identifies
  // one. Looking it up through the book's own scoped list means there is no
  // second place where ownership has to be checked.
  const pages = await listPagesForBook(user.id, book.id);
  const parsedNumber = Number(pageNumber);
  const page = pages.find((candidate) => candidate.pageNumber === parsedNumber);

  if (!page) {
    notFound();
  }

  const index = pages.indexOf(page);
  const previous = index > 0 ? pages[index - 1] : undefined;
  const next = index < pages.length - 1 ? pages[index + 1] : undefined;

  const annotations = await listAnnotationsForPage(user.id, page.id);

  let imageUrl: string | null = null;

  try {
    imageUrl = (await createSignedRead(page.storageKey)).url;
  } catch {
    imageUrl = null;
  }

  return (
    <main className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col">
          <Link href={`/books/${book.id}`} className="text-sm underline">
            {book.title}
          </Link>
          <h1 className="font-serif text-2xl">Page {page.pageNumber}</h1>
        </div>

        <nav className="flex gap-4 text-sm">
          {previous ? (
            <Link
              href={`/books/${book.id}/pages/${previous.pageNumber}`}
              className="underline"
            >
              ← Page {previous.pageNumber}
            </Link>
          ) : null}
          {next ? (
            <Link
              href={`/books/${book.id}/pages/${next.pageNumber}`}
              className="underline"
            >
              Page {next.pageNumber} →
            </Link>
          ) : null}
        </nav>
      </div>

      {imageUrl ? (
        <PageAnnotator
          pageId={page.id}
          imageUrl={imageUrl}
          imageWidth={page.imageWidth}
          imageHeight={page.imageHeight}
          annotations={annotations}
        />
      ) : (
        <p role="alert" className="text-sm text-red-600">
          That image could not be loaded right now, so it cannot be annotated.
        </p>
      )}

      <p className="text-xs text-ink-muted">
        {page.imageWidth} × {page.imageHeight} pixels. Annotation coordinates are
        stored as fractions of these dimensions, never as pixels.
      </p>
    </main>
  );
}
