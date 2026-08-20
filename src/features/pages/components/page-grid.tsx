import Link from "next/link";

import type { BookId } from "@/db/ids";

import type { Page } from "../pages.types";

type PageGridProps = {
  bookId: BookId;
  pages: Page[];
  /** Signed read URL per page id. Signed by the server, expires in minutes. */
  previewUrls: Map<string, string>;
};

/**
 * Thumbnails of every page in a book.
 *
 * The images are private objects, so each `src` is a signed URL the page
 * component generated for this render. They stop working after a few minutes,
 * which is fine: the next render signs new ones.
 */
export function PageGrid({ bookId, pages, previewUrls }: PageGridProps) {
  if (pages.length === 0) {
    return (
      <p className="text-ink-muted">
        No pages yet. Photograph one and upload it above.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {pages.map((page) => {
        const previewUrl = previewUrls.get(page.id);

        return (
          <li key={page.id}>
            <Link
              href={`/books/${bookId}/pages/${page.pageNumber}`}
              className="flex flex-col gap-2"
            >
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt={`Page ${page.pageNumber}`}
                  className="w-full rounded border border-ink-muted/20 object-cover"
                  // The intrinsic size is known, so the browser can reserve the
                  // right space before the bytes arrive and the grid does not
                  // jump as images load.
                  width={page.imageWidth}
                  height={page.imageHeight}
                  loading="lazy"
                />
              ) : (
                <div className="flex aspect-[3/4] items-center justify-center rounded border border-ink-muted/20 text-xs text-ink-muted">
                  Preview unavailable
                </div>
              )}
              <span className="text-sm text-ink-muted">
                Page {page.pageNumber}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
