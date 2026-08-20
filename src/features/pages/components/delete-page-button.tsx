"use client";

import type { PageId } from "@/db/ids";

import { deletePageAction } from "../pages.actions";

export function DeletePageButton({
  pageId,
  pageNumber,
  annotationCount,
}: {
  pageId: PageId;
  pageNumber: number;
  annotationCount: number;
}) {
  const noteLabel = annotationCount === 1 ? "annotation" : "annotations";

  return (
    <form
      action={deletePageAction}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Delete page ${pageNumber}? This permanently deletes the page image and ${annotationCount} ${noteLabel}.`,
        );
        if (!confirmed) event.preventDefault();
      }}
    >
      <input type="hidden" name="pageId" value={pageId} />
      <button type="submit" className="text-xs text-danger underline underline-offset-4">
        Delete page
      </button>
    </form>
  );
}
