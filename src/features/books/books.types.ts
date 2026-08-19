import type { books } from "@/db/schema";

/** A book row exactly as stored. Derived from the schema so the two can never
 * disagree — there is no hand-maintained duplicate of the column list. */
export type Book = typeof books.$inferSelect;

/**
 * Everything needed to create a book, minus the fields the server owns.
 * `id`, `userId`, `createdAt` and `updatedAt` are deliberately absent: they are
 * not the caller's to supply.
 */
export type NewBook = {
  title: string;
  author: string;
  series: string | null;
  seriesIndex: number | null;
  coverUrl: string | null;
  openLibraryId: string | null;
};
