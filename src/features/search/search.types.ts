import type { AnnotationId, BookId, PageId } from "@/db/ids";

/**
 * Postgres marks matches inside a snippet with these, and the UI turns them
 * into `<mark>` elements.
 *
 * They are control characters, not `<b>` or `«»`, for two reasons. Returning
 * HTML from the database would mean rendering it with `dangerouslySetInnerHTML`,
 * and the text being highlighted is a user's own note and a model's output —
 * neither is something to hand to an HTML parser. And unlike a visible
 * character such as `«`, these cannot occur naturally in a book passage, so
 * splitting on them can never cut real text in half.
 */
export const HIGHLIGHT_START = "";
export const HIGHLIGHT_END = "";

/**
 * One search hit, flattened for display.
 *
 * This is a read model, not a domain object: it deliberately mixes fields from
 * annotations, pages and books, because a result is only useful with the book
 * and page it came from. Nothing writes through this shape.
 */
export type SearchResult = {
  annotationId: AnnotationId;
  pageId: PageId;
  pageNumber: number;
  bookId: BookId;
  bookTitle: string;
  bookAuthor: string;

  /** Snippets with matches marked, produced by `ts_headline`. */
  commentSnippet: string;
  passageSnippet: string | null;
  contextSnippet: string | null;

  /** Where the model got to. A pending annotation is still searchable by note. */
  enrichmentStatus: "pending" | "complete" | "failed";
  anchor: "region" | "text";

  /** `ts_rank_cd` score. Only meaningful relative to the other rows. */
  rank: number;
};
