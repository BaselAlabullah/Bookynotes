import type { UserId } from "@/db/ids";
import { findBook } from "@/features/books/books.repository";

import { insertPage } from "./pages.repository";
import type { NewPage, Page } from "./pages.types";

/**
 * Operations on pages that need to know about another domain.
 *
 * The layering rule this file exists to demonstrate: a *repository* touches
 * only its own tables; a *service* may call another feature's repository. The
 * arrow only ever points from service to repository, never repository to
 * repository, so there is no cycle to reason about.
 */

/**
 * Create a page, but only inside a book the user actually owns.
 *
 * Without this check the flaw is subtle and total: `insertPage` would happily
 * write a row stamped with the caller's `user_id` pointing at a stranger's
 * `book_id`. Every later query scopes by `user_id`, so the row would look
 * legitimate forever, and the caller would have attached themselves to someone
 * else's book.
 *
 * Returns null when the book does not exist or is not theirs — the same answer
 * for both, so nothing can be inferred from the difference.
 */
export async function createPage(
  userId: UserId,
  input: NewPage,
): Promise<Page | null> {
  const book = await findBook(userId, input.bookId);

  if (!book) {
    return null;
  }

  return insertPage(userId, input);
}
