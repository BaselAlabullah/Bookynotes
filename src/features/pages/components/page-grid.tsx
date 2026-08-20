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
      <p className="border-y border-rule py-8 text-sm text-ink-muted">No pages yet. Add a photograph above; it will become the page you can mark and annotate.</p>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-4 lg:grid-cols-6">
      {pages.map((page, index) => {
        const previewUrl = previewUrls.get(page.id);

        return (
          <li key={page.id}>
            <Link
              href={`/books/${bookId}/pages/${page.pageNumber}`}
              className="group flex flex-col gap-2"
            >
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt={`Page ${page.pageNumber}`}
                  className="w-full border border-rule object-cover shadow-[3px_4px_0_var(--color-rule)] transition-transform group-hover:-translate-y-0.5"
                  // The intrinsic size is known, so the browser can reserve the
                  // right space before the bytes arrive and the grid does not
                  // jump as images load.
                  width={page.imageWidth}
                  height={page.imageHeight}
                  loading={index < 8 ? "eager" : "lazy"}
                  fetchPriority={index < 8 ? "high" : "auto"}
                  decoding="async"
                />
              ) : (
                <div className="flex aspect-[3/4] items-center justify-center border border-rule text-xs text-ink-muted">
                  Preview unavailable
                </div>
              )}
              <span className="font-serif text-sm tabular-nums text-ink-muted group-hover:text-accent">
                Page {page.pageNumber}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
