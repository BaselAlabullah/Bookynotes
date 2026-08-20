import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import type { BookId, UserId } from "@/db/ids";
import { books } from "@/db/schema";

import type { Book, NewBook } from "./books.types";

/**
 * Every query against the `books` table. Nothing else in the app writes SQL
 * for it.
 *
 * Two rules hold for every function here and in the sibling repositories:
 *
 * 1. `userId` is the first parameter, always, and always appears in the WHERE
 *    clause. A function that does not take one does not belong in this file.
 * 2. A row that does not exist and a row belonging to somebody else are the
 *    same answer: `null`. Distinguishing them would let a stranger probe which
 *    ids are real, and it saves inventing an error hierarchy to say so.
 */

export async function createBook(userId: UserId, input: NewBook): Promise<Book> {
  const [created] = await db
    .insert(books)
    .values({ ...input, userId })
    .returning();

  // `.returning()` on a single-row insert always yields exactly one row; if it
  // did not, the insert threw. This narrows the type without a non-null
  // assertion, which `noUncheckedIndexedAccess` would otherwise require.
  if (!created) {
    throw new Error("Insert into books returned no row");
  }

  return created;
}

/**
 * Record where our own copy of the cover lives.
 *
 * A separate statement rather than part of the insert, because the copy is made
 * after the row exists — the storage key is derived from the book id.
 */
export async function setBookCoverStorageKey(
  userId: UserId,
  bookId: BookId,
  coverStorageKey: string,
): Promise<void> {
  await db
    .update(books)
    .set({ coverStorageKey, updatedAt: new Date() })
    .where(and(eq(books.id, bookId), eq(books.userId, userId)));
}

export async function listBooks(userId: UserId): Promise<Book[]> {
  return db
    .select()
    .from(books)
    .where(eq(books.userId, userId))
    .orderBy(desc(books.createdAt));
}

export async function findBook(
  userId: UserId,
  bookId: BookId,
): Promise<Book | null> {
  const [book] = await db
    .select()
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .limit(1);

  return book ?? null;
}

/** Returns false when the book does not exist or is not this user's. Pages and
 * annotations below it are removed by ON DELETE CASCADE, not by this function. */
export async function deleteBook(
  userId: UserId,
  bookId: BookId,
): Promise<boolean> {
  const deleted = await db
    .delete(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId)))
    .returning({ id: books.id });

  return deleted.length > 0;
}
