import Link from "next/link";

import type { BookId } from "@/db/ids";

import type { Book } from "../books.types";
import { BookCover } from "./book-cover";
import type { BookDashboardStats } from "../books.service";
import { DeleteBookButton } from "./delete-book-button";

/**
 * The user's library. A server component: it renders data the page already
 * fetched and needs no interactivity, so none of this reaches the browser as
 * JavaScript.
 */
export function LibraryList({
  books,
  coverUrls,
  dashboardStats,
}: {
  books: Book[];
  /** Signed URLs for our own stored covers, keyed by book id. */
  coverUrls: Map<BookId, string>;
  dashboardStats: Map<BookId, BookDashboardStats>;
}) {
  if (books.length === 0) {
    return (
      <div className="flex min-h-72 flex-col items-start justify-center gap-5 border-y border-rule py-12">
        <h2 className="font-serif text-2xl">Begin with the book in your hand.</h2>
        <p className="max-w-[48ch] text-sm leading-6 text-ink-muted">Search by title or author, add the edition, then photograph the first page you want to remember.</p>
        <Link
          href="/library/add"
          className="bg-accent px-4 py-2 text-sm font-medium text-paper"
        >
          Add your first book
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid gap-x-8 gap-y-0 sm:grid-cols-2 lg:grid-cols-3">
      {books.map((book, index) => {
        const stats = dashboardStats.get(book.id) ?? emptyStats;
        const missingPassageCount =
          stats.pendingPassageCount + stats.failedPassageCount;
        const hasOpenWork =
          stats.missingTranscriptCount > 0 || missingPassageCount > 0;

        return (
          <li
            key={book.id}
            className="border-b border-rule"
          >
            <Link href={`/books/${book.id}`} className="group flex items-start gap-4 py-6">
              <BookCover
                // Our copy first; Open Library's URL only for books added before
                // covers were stored locally.
                url={coverUrls.get(book.id) ?? book.coverUrl}
                storageKey={book.coverStorageKey}
                title={book.title}
                eager={index < 4}
              />

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div>
                  <h2 className="font-serif text-xl leading-snug group-hover:text-accent">{book.title}</h2>
                  <p className="text-sm text-ink-muted">{book.author}</p>
                  {book.series ? (
                    <p className="text-xs text-ink-muted">
                      {book.series}
                      {book.seriesIndex === null ? "" : ` #${book.seriesIndex}`}
                    </p>
                  ) : null}
                </div>

                <dl className="grid grid-cols-3 gap-2 text-xs uppercase tracking-[0.09em] text-ink-muted">
                  <LibraryStat label="Pages" value={stats.pageCount} />
                  <LibraryStat label="Notes" value={stats.annotationCount} />
                  <LibraryStat
                    label="Read"
                    value={`${stats.completeTranscriptCount}/${stats.pageCount}`}
                  />
                </dl>

                {hasOpenWork ? (
                  <p className="text-xs text-accent">
                    {formatOpenWork(stats)}
                  </p>
                ) : stats.pageCount > 0 ? (
                  <p className="text-xs text-ink-muted">All captured pages are processed.</p>
                ) : (
                  <p className="text-xs text-ink-muted">No pages captured yet.</p>
                )}
              </div>
            </Link>
            <div className="pb-4 pl-[108px]">
              <DeleteBookButton
                bookId={book.id}
                title={book.title}
                impact={stats}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const emptyStats: BookDashboardStats = {
  pageCount: 0,
  annotationCount: 0,
  completeTranscriptCount: 0,
  missingTranscriptCount: 0,
  pendingPassageCount: 0,
  failedPassageCount: 0,
  flattenedPageCount: 0,
};

function LibraryStat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="mt-0.5 text-sm tracking-normal text-ink">{value}</dd>
    </div>
  );
}

function formatOpenWork(stats: BookDashboardStats) {
  const items: string[] = [];
  const missingPassageCount =
    stats.pendingPassageCount + stats.failedPassageCount;

  if (stats.missingTranscriptCount > 0) {
    items.push(
      `${stats.missingTranscriptCount} ${
        stats.missingTranscriptCount === 1 ? "transcript" : "transcripts"
      } missing`,
    );
  }

  if (missingPassageCount > 0) {
    items.push(
      `${missingPassageCount} ${
        missingPassageCount === 1 ? "passage" : "passages"
      } pending`,
    );
  }

  return items.join(" · ");
}
