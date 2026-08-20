import { z } from "zod";

/**
 * Open Library's response shape, as far as we rely on it.
 *
 * Almost every field is optional, and that is not defensive padding — the API
 * genuinely omits `author_name` and `cover_i` for a large fraction of works.
 * Marking them required would mean a search for a real book throwing a
 * validation error.
 */
export const openLibraryDocSchema = z.object({
  /** e.g. "/works/OL20893680W" */
  key: z.string().startsWith("/works/"),
  title: z.string().min(1),
  author_name: z.array(z.string()).optional(),
  first_publish_year: z.number().int().optional(),
  cover_i: z.number().int().optional(),
  edition_count: z.number().int().optional(),
});

/**
 * `docs` is deliberately `unknown[]` here rather than an array of the schema
 * above. Each document is validated on its own afterwards, so one malformed
 * record — a work with no title, say — drops out of the results instead of
 * failing the entire search.
 */
export const openLibraryResponseSchema = z.object({
  docs: z.array(z.unknown()),
});

/**
 * Our own result shape, expressed as a schema so the type and the runtime
 * validator are the same artifact.
 *
 * It is defined here rather than in the books feature because the browser also
 * has to validate it: the search endpoint returns JSON, and JSON arriving over
 * a network is `unknown` no matter who wrote the endpoint.
 */
export const bookSearchResultSchema = z.object({
  openLibraryId: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  firstPublishYear: z.number().int().nullable(),
  coverUrl: z.url().nullable(),
  editionCount: z.number().int(),
});

export const bookSearchResponseSchema = z.object({
  results: z.array(bookSearchResultSchema),
});

/** The error envelope every route handler in this app returns on failure. */
export const apiErrorSchema = z.object({ error: z.string() });
