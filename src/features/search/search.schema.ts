import { z } from "zod";

/**
 * The query string from the URL.
 *
 * Search lives in `?q=`, so the query is shareable, bookmarkable and survives
 * the back button. That also means it arrives as `string | undefined` from a
 * URL a stranger can write, which is why it is parsed rather than trusted.
 */
export const searchQuerySchema = z
  .string()
  .trim()
  // Long enough to be worth running. A single character matches a large share
  // of an English index and returns noise slowly.
  .min(2, "Type at least two characters.")
  .max(200, "That search is too long.");

/**
 * One page of results. There is no infinite scroll: a reader looking for a
 * half-remembered passage either finds it near the top or refines the words.
 */
export const RESULTS_PER_PAGE = 25;
