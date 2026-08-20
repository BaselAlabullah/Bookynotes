/**
 * Recognising the database errors we deliberately let happen.
 *
 * The unique constraint on `(book_id, page_number)` is not a bug guard, it is
 * the feature: it is how "you already uploaded page 12" is enforced under
 * concurrent requests, where a read-then-write check would race. That means the
 * violation is an expected outcome and has to be told apart from a real failure.
 */

/** Postgres class 23 is integrity constraint violation; 23505 is uniqueness. */
const UNIQUE_VIOLATION = "23505";

/** Deep enough for Drizzle's wrapper, shallow enough not to walk a cycle. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Whether this error, or anything it wraps, is a unique constraint violation.
 *
 * The cause chain is not optional cleverness. Drizzle raises a
 * `DrizzleQueryError` carrying the SQL and parameters, and hangs the driver's
 * real error off `.cause` — so `error.code` on the thing you catch is
 * `undefined`, and a check that only looks at the top level silently misses
 * every constraint violation. That mistake was live in this file until an
 * end-to-end test uploaded page 12 twice and got a 500 instead of a 409.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }

    if (
      "code" in current &&
      (current as { code: unknown }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }

    current = "cause" in current ? (current as { cause: unknown }).cause : null;
  }

  return false;
}
