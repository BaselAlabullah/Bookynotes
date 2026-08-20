import Link from "next/link";

import type { Book } from "../books.types";
import { BookCover } from "./book-cover";

/**
 * The user's library. A server component: it renders data the page already
 * fetched and needs no interactivity, so none of this reaches the browser as
 * JavaScript.
 */
export function LibraryList({ books }: { books: Book[] }) {
  if (books.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-ink-muted/30 p-8">
        <p className="text-ink-muted">
          No books yet. Add one and start marking passages.
        </p>
        <Link
          href="/library/add"
          className="rounded-md bg-accent px-4 py-2 font-medium text-paper"
        >
          Add your first book
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {books.map((book) => (
        <li
          key={book.id}
          className="flex items-start gap-4 rounded-lg border border-ink-muted/15 p-4"
        >
          <BookCover url={book.coverUrl} title={book.title} />

          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-lg">{book.title}</h2>
            <p className="text-sm text-ink-muted">{book.author}</p>
            {book.series ? (
              <p className="text-xs text-ink-muted">
                {book.series}
                {book.seriesIndex === null ? "" : ` #${book.seriesIndex}`}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
