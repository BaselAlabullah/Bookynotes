import Link from "next/link";

import type { BookId } from "@/db/ids";

import type { Book } from "../books.types";
import { BookCover } from "./book-cover";

/**
 * The user's library. A server component: it renders data the page already
 * fetched and needs no interactivity, so none of this reaches the browser as
 * JavaScript.
 */
export function LibraryList({
  books,
  coverUrls,
}: {
  books: Book[];
  /** Signed URLs for our own stored covers, keyed by book id. */
  coverUrls: Map<BookId, string>;
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
      {books.map((book, index) => (
        <li
          key={book.id}
          className="border-b border-rule"
        >
          <Link href={`/books/${book.id}`} className="group flex items-start gap-4 py-6">
            <BookCover
              // Our copy first; Open Library's URL only for books added before
              // covers were stored locally.
              url={coverUrls.get(book.id) ?? book.coverUrl}
              title={book.title}
              eager={index < 4}
            />

            <div className="flex flex-col gap-1">
              <h2 className="font-serif text-xl leading-snug group-hover:text-accent">{book.title}</h2>
              <p className="text-sm text-ink-muted">{book.author}</p>
              {book.series ? (
                <p className="text-xs text-ink-muted">
                  {book.series}
                  {book.seriesIndex === null ? "" : ` #${book.seriesIndex}`}
                </p>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
