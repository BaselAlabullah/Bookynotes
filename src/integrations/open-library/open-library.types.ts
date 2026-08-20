import type { z } from "zod";

import type { bookSearchResultSchema } from "./open-library.schema";

/**
 * Our shape for a search result, not Open Library's.
 *
 * Everything downstream codes against this type, which is what makes the
 * provider swappable: replacing Open Library means writing another module that
 * returns these, not touching the books feature.
 *
 * Inferred from the zod schema rather than declared separately, so the compile
 * time type and the runtime validator cannot drift apart.
 */
export type BookSearchResult = z.infer<typeof bookSearchResultSchema>;

/** Thrown when Open Library is unreachable, slow, or answers with nonsense. */
export class OpenLibraryError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "OpenLibraryError";
  }
}
