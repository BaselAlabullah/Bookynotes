import type { BookId, UserId } from "@/db/ids";
import {
  countAnnotationStatusesForPages,
  countAnnotationsForPages,
} from "@/features/annotations/annotations.repository";
import { listPagesForBook, listPagesForBooks } from "@/features/pages/pages.repository";
import { removeObjects } from "@/integrations/storage/storage.client";

import { deleteBook, findBook } from "./books.repository";

export type BookDeletionImpact = {
  pageCount: number;
  annotationCount: number;
};

export type BookDashboardStats = BookDeletionImpact & {
  completeTranscriptCount: number;
  missingTranscriptCount: number;
  pendingPassageCount: number;
  failedPassageCount: number;
  flattenedPageCount: number;
};

const emptyBookDashboardStats = (): BookDashboardStats => ({
  pageCount: 0,
  annotationCount: 0,
  completeTranscriptCount: 0,
  missingTranscriptCount: 0,
  pendingPassageCount: 0,
  failedPassageCount: 0,
  flattenedPageCount: 0,
});

export async function getBookDeletionImpacts(
  userId: UserId,
  bookIds: BookId[],
): Promise<Map<BookId, BookDeletionImpact>> {
  const pages = await listPagesForBooks(userId, bookIds);
  const annotationCounts = await countAnnotationsForPages(
    userId,
    pages.map((page) => page.id),
  );
  const impacts = new Map<BookId, BookDeletionImpact>();

  for (const bookId of bookIds) {
    impacts.set(bookId, { pageCount: 0, annotationCount: 0 });
  }

  for (const page of pages) {
    const impact = impacts.get(page.bookId);
    if (!impact) continue;
    impact.pageCount += 1;
    impact.annotationCount += annotationCounts.get(page.id) ?? 0;
  }

  return impacts;
}

export async function getBookDashboardStats(
  userId: UserId,
  bookIds: BookId[],
): Promise<Map<BookId, BookDashboardStats>> {
  const pages = await listPagesForBooks(userId, bookIds);
  const annotationStats = await countAnnotationStatusesForPages(
    userId,
    pages.map((page) => page.id),
  );
  const stats = new Map<BookId, BookDashboardStats>();

  for (const bookId of bookIds) {
    stats.set(bookId, emptyBookDashboardStats());
  }

  for (const page of pages) {
    const bookStats = stats.get(page.bookId);
    if (!bookStats) continue;

    const pageStats = annotationStats.get(page.id);
    bookStats.pageCount += 1;
    bookStats.annotationCount += pageStats?.annotationCount ?? 0;
    bookStats.pendingPassageCount += pageStats?.pendingPassageCount ?? 0;
    bookStats.failedPassageCount += pageStats?.failedPassageCount ?? 0;
    bookStats.flattenedPageCount += page.originalStorageKey ? 1 : 0;

    if (page.transcriptStatus === "complete") {
      bookStats.completeTranscriptCount += 1;
    } else {
      bookStats.missingTranscriptCount += 1;
    }
  }

  return stats;
}

export type DeleteBookResult =
  | { status: "not-found" }
  | { status: "deleted"; cleanupIncomplete: boolean };

/** Collect every descendant key before the database cascade erases it. */
export async function deleteBookAndObjects(
  userId: UserId,
  bookId: BookId,
): Promise<DeleteBookResult> {
  const [book, pages] = await Promise.all([
    findBook(userId, bookId),
    listPagesForBook(userId, bookId),
  ]);

  if (!book) return { status: "not-found" };

  const keys = [
    book.coverStorageKey,
    ...pages.flatMap((page) => [
      page.storageKey,
      page.thumbnailStorageKey,
      page.originalStorageKey,
    ]),
  ].filter((key): key is string => key !== null);

  if (!(await deleteBook(userId, book.id))) return { status: "not-found" };

  try {
    await removeObjects(keys);
    return { status: "deleted", cleanupIncomplete: false };
  } catch {
    return { status: "deleted", cleanupIncomplete: true };
  }
}
