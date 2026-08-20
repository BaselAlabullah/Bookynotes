"use client";

import type { BookId } from "@/db/ids";

import { deleteBookAction } from "../books.actions";
import type { BookDeletionImpact } from "../books.service";

export function DeleteBookButton({
  bookId,
  title,
  impact,
}: {
  bookId: BookId;
  title: string;
  impact: BookDeletionImpact;
}) {
  const pageLabel = impact.pageCount === 1 ? "page" : "pages";
  const noteLabel = impact.annotationCount === 1 ? "annotation" : "annotations";

  return (
    <form
      action={deleteBookAction}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Delete “${title}”? This permanently deletes ${impact.pageCount} ${pageLabel} and ${impact.annotationCount} ${noteLabel}.`,
        );
        if (!confirmed) event.preventDefault();
      }}
    >
      <input type="hidden" name="bookId" value={bookId} />
      <button type="submit" className="text-xs text-danger underline underline-offset-4">
        Delete book
      </button>
    </form>
  );
}
