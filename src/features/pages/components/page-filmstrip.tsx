import Link from "next/link";

import type { BookId, PageId } from "@/db/ids";

import type { Page } from "../pages.types";

export function PageFilmstrip({
  bookId,
  pages,
  previewUrls,
  currentPageId,
}: {
  bookId: BookId;
  pages: Page[];
  previewUrls: Map<string, string>;
  currentPageId: PageId;
}) {
  if (pages.length < 2) return null;

  return (
    <nav className="page-filmstrip -mx-1 overflow-x-auto px-1 pb-1" aria-label="Pages in this book">
      <ol className="flex min-w-max gap-2">
        {pages.map((page) => {
          const previewUrl = previewUrls.get(page.id);
          const isCurrent = page.id === currentPageId;

          return (
            <li key={page.id}>
              <Link
                href={`/books/${bookId}/pages/${page.pageNumber}`}
                aria-current={isCurrent ? "page" : undefined}
                className={`group flex w-14 flex-col gap-1 border-b-2 pb-1 ${isCurrent ? "border-accent" : "border-transparent"}`}
              >
                {previewUrl ? (
                  // Private, short-lived storage URL; next/image would spend
                  // metered optimization quota for a tiny thumbnail.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt=""
                    width={page.imageWidth}
                    height={page.imageHeight}
                    className="h-12 w-11 self-center object-cover opacity-70 grayscale transition-opacity group-hover:opacity-100"
                  />
                ) : (
                  <span className="h-12 w-11 self-center border border-rule bg-paper-deep" />
                )}
                <span className={`text-center text-[10px] tabular-nums ${isCurrent ? "text-accent" : "text-ink-muted"}`}>{page.pageNumber}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
