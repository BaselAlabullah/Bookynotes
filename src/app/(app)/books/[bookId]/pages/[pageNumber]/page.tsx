import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { asBookId } from "@/db/ids";
import { listAnnotationsForPage } from "@/features/annotations/annotations.repository";
import { PageSurface } from "@/features/pages/components/page-surface";
import { requireUser } from "@/features/auth/auth.session";
import { findBook } from "@/features/books/books.repository";
import { PageFilmstrip } from "@/features/pages/components/page-filmstrip";
import { listPagesForBook } from "@/features/pages/pages.repository";
import { signPageImages } from "@/features/pages/pages.images";

/** A page view keeps every rendered rectangle in normalized image space. */
export default async function PageView({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string; pageNumber: string }>;
  searchParams: Promise<{ annotation?: string }>;
}) {
  const user = await requireUser();
  const { bookId, pageNumber } = await params;
  const { annotation: selectedAnnotationId } = await searchParams;
  // Both queries need only the user and the book id, so waiting for the first
  // before starting the second bought nothing but a second round trip. The
  // database is in Tokyo; each of these costs roughly a quarter of a second,
  // and this page used to make five of them in a row.
  const resolvedBookId = asBookId(bookId);
  const [book, pages] = await Promise.all([
    findBook(user.id, resolvedBookId),
    listPagesForBook(user.id, resolvedBookId),
  ]);

  if (!book) notFound();

  const parsedNumber = Number(pageNumber);
  const page = pages.find((candidate) => candidate.pageNumber === parsedNumber);

  if (!page) notFound();

  const index = pages.indexOf(page);
  const previous = index > 0 ? pages[index - 1] : undefined;
  const next = index < pages.length - 1 ? pages[index + 1] : undefined;

  // Annotations and image signing both depend on the page, and on nothing from
  // each other, so they overlap too.
  //
  // One signing request covers the whole view: a thumbnail for every filmstrip
  // frame, plus the full-size photograph for the page actually being read.
  const [annotations, { thumbnails: previewUrls, full }] = await Promise.all([
    listAnnotationsForPage(user.id, page.id),
    signPageImages(pages, [page.id]),
  ]);
  const imageUrl = full.get(page.id) ?? null;
  const previousHref = previous
    ? `/books/${book.id}/pages/${previous.pageNumber}`
    : undefined;
  const nextHref = next
    ? `/books/${book.id}/pages/${next.pageNumber}`
    : undefined;

  return (
    <main className="flex flex-col gap-5">
      <Breadcrumbs
        items={[
          { label: "Library", href: "/library" },
          { label: book.title, href: `/books/${book.id}` },
          { label: `Page ${page.pageNumber}` },
        ]}
      />

      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-ink-muted">{book.author}</p>
          <h1 className="mt-1 font-serif text-2xl tracking-tight">{book.title}</h1>
        </div>
        <div className="flex items-center gap-5">
          <nav className="screen-only flex gap-4 text-xs text-ink-muted" aria-label="Adjacent pages">
            {previousHref && previous ? (
              <Link href={previousHref} className="underline decoration-rule underline-offset-4 hover:text-ink">← {previous.pageNumber}</Link>
            ) : null}
            {nextHref && next ? (
              <Link href={nextHref} className="underline decoration-rule underline-offset-4 hover:text-ink">{next.pageNumber} →</Link>
            ) : null}
          </nav>
          <p className="font-serif text-lg tabular-nums [font-variant-numeric:oldstyle-nums]">Page {page.pageNumber}</p>
        </div>
      </header>

      <PageFilmstrip bookId={book.id} pages={pages} previewUrls={previewUrls} currentPageId={page.id} />

      {imageUrl ? (
        <PageSurface
          pageId={page.id}
          imageUrl={imageUrl}
          imageWidth={page.imageWidth}
          imageHeight={page.imageHeight}
          annotations={annotations}
          initialSelectedId={selectedAnnotationId}
          previousHref={previousHref}
          nextHref={nextHref}
          transcript={page.transcript}
          transcriptStatus={page.transcriptStatus}
          transcriptError={page.transcriptError}
          pageNumber={page.pageNumber}
          transcriptPageNumber={page.transcriptPageNumber}
        />
      ) : (
        <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
          That image could not be loaded right now, so it cannot be annotated.
        </p>
      )}

      <p className="screen-only text-[11px] text-ink-muted">
        {page.imageWidth} × {page.imageHeight} pixels · marks stored as normalized coordinates
      </p>
    </main>
  );
}
