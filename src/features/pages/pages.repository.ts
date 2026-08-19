import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import type { BookId, PageId, UserId } from "@/db/ids";
import { pages } from "@/db/schema";

import type { NewPage, Page } from "./pages.types";

/**
 * Every query against the `pages` table, and nothing else.
 *
 * Note what is missing: this file never checks that `input.bookId` belongs to
 * the user. It cannot — the answer lives in the `books` table, which is not
 * this repository's to read. That check is `pages.service.ts`'s job, and
 * `createPage` here is not exported for use anywhere else.
 */

export async function insertPage(userId: UserId, input: NewPage): Promise<Page> {
  const [created] = await db
    .insert(pages)
    .values({ ...input, userId })
    .returning();

  if (!created) {
    throw new Error("Insert into pages returned no row");
  }

  return created;
}

export async function listPagesForBook(
  userId: UserId,
  bookId: BookId,
): Promise<Page[]> {
  return db
    .select()
    .from(pages)
    .where(and(eq(pages.bookId, bookId), eq(pages.userId, userId)))
    .orderBy(asc(pages.pageNumber));
}

export async function findPage(
  userId: UserId,
  pageId: PageId,
): Promise<Page | null> {
  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.userId, userId)))
    .limit(1);

  return page ?? null;
}

export async function deletePage(
  userId: UserId,
  pageId: PageId,
): Promise<boolean> {
  const deleted = await db
    .delete(pages)
    .where(and(eq(pages.id, pageId), eq(pages.userId, userId)))
    .returning({ id: pages.id });

  return deleted.length > 0;
}
