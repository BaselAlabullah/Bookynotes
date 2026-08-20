import {
  OpenLibraryError,
  type BookSearchResult,
} from "./open-library.types";
import {
  openLibraryDocSchema,
  openLibraryResponseSchema,
} from "./open-library.schema";

const SEARCH_ENDPOINT = "https://openlibrary.org/search.json";

/**
 * Asking for specific fields is not an optimisation, it is the difference
 * between a 2 KB response and a 400 KB one: the default response includes every
 * edition, every ISBN and the full text search index for each work.
 */
const FIELDS = [
  "key",
  "title",
  "author_name",
  "first_publish_year",
  "cover_i",
  "edition_count",
].join(",");

const RESULT_LIMIT = 10;

/**
 * Open Library has no SLA and is frequently slow. Without a timeout, a hanging
 * request would sit there until the serverless function itself times out, which
 * gives the user a blank page instead of an error they can act on.
 */
const TIMEOUT_MS = 8_000;

/** Cover sizes are S, M and L. M is 180px wide, which is what the UI shows. */
function coverUrlFor(coverId: number | undefined): string | null {
  return coverId === undefined
    ? null
    : `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
}

export async function searchBooks(query: string): Promise<BookSearchResult[]> {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("limit", String(RESULT_LIMIT));

  let response: Response;

  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Open Library asks that clients identify themselves so they can
        // contact you rather than silently rate limit you.
        "User-Agent": "Marginalia/0.1 (github.com/marginalia)",
      },
    });
  } catch (cause) {
    throw new OpenLibraryError("Could not reach Open Library.", { cause });
  }

  if (!response.ok) {
    throw new OpenLibraryError(
      `Open Library responded with ${response.status}.`,
    );
  }

  const body: unknown = await response.json();
  const parsed = openLibraryResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new OpenLibraryError("Open Library returned an unexpected shape.");
  }

  const results: BookSearchResult[] = [];

  for (const doc of parsed.data.docs) {
    const parsedDoc = openLibraryDocSchema.safeParse(doc);

    // Skip, do not throw. A single unusable record should cost the user one
    // result, not the whole search.
    if (!parsedDoc.success) {
      continue;
    }

    const { key, title, author_name, first_publish_year, cover_i, edition_count } =
      parsedDoc.data;

    results.push({
      openLibraryId: key.replace("/works/", ""),
      title,
      // Works list every contributor; the first is the one people recognise.
      // Storing all of them would mean a join table for no gain here.
      author: author_name?.[0] ?? null,
      firstPublishYear: first_publish_year ?? null,
      coverUrl: coverUrlFor(cover_i),
      editionCount: edition_count ?? 0,
    });
  }

  return results;
}
