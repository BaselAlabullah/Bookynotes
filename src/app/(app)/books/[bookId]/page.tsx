import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { asBookId } from "@/db/ids";
import { requireUser } from "@/features/auth/auth.session";
import { findBook } from "@/features/books/books.repository";
import { PageGrid } from "@/features/pages/components/page-grid";
import { PageUploader } from "@/features/pages/components/page-uploader";
import { listPagesForBook } from "@/features/pages/pages.repository";
import { signPageImages } from "@/features/pages/pages.images";
import {
  getPageDashboardStats,
  type PageDashboardStats,
} from "@/features/pages/pages.service";

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
  const [{ thumbnails: previewUrls }, pageStats] = await Promise.all([
    signPageImages(pages),
    getPageDashboardStats(
      user.id,
      pages.map((page) => page.id),
    ),
  ]);
  const dashboard = summarizeBookPage(pages, pageStats);
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

      <dl className="grid gap-3 border-y border-rule py-4 sm:grid-cols-2 lg:grid-cols-5">
        <BookMetric label="Pages" value={pages.length} />
        <BookMetric label="Notes" value={dashboard.annotationCount} />
        <BookMetric
          label="Transcripts"
          value={`${dashboard.completeTranscriptCount}/${pages.length}`}
        />
        <BookMetric label="Pending passages" value={dashboard.pendingPassageCount} />
        <BookMetric label="Failed passages" value={dashboard.failedPassageCount} tone={dashboard.failedPassageCount > 0 ? "danger" : "muted"} />
      </dl>

      <PageUploader
        key={nextPageNumber}
        bookId={book.id}
        nextPageNumber={nextPageNumber}
      />

      <PageGrid bookId={book.id} pages={pages} previewUrls={previewUrls} pageStats={pageStats} />
    </main>
  );
}

function summarizeBookPage(
  pages: Awaited<ReturnType<typeof listPagesForBook>>,
  pageStats: Map<string, PageDashboardStats>,
) {
  return pages.reduce(
    (summary, page) => {
      const stats = pageStats.get(page.id);

      summary.annotationCount += stats?.annotationCount ?? 0;
      summary.pendingPassageCount += stats?.pendingPassageCount ?? 0;
      summary.failedPassageCount += stats?.failedPassageCount ?? 0;
      summary.completeTranscriptCount +=
        page.transcriptStatus === "complete" ? 1 : 0;

      return summary;
    },
    {
      annotationCount: 0,
      pendingPassageCount: 0,
      failedPassageCount: 0,
      completeTranscriptCount: 0,
    },
  );
}

function BookMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "muted" | "danger";
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-[0.12em] text-ink-muted">{label}</dt>
      <dd
        className={`font-serif text-2xl tabular-nums ${
          tone === "danger"
            ? "text-danger"
            : tone === "muted"
              ? "text-ink-muted"
              : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
