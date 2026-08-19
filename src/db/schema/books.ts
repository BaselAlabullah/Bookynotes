import { index, integer, pgTable, text } from "drizzle-orm/pg-core";

import type { BookId } from "@/db/ids";

import { primaryId, timestamps, userIdColumn } from "./shared-columns";

/**
 * A book in a user's library.
 *
 * There is no uniqueness constraint on (user_id, open_library_id): the same
 * physical title can legitimately be added twice — a second copy, a different
 * edition, a reread with fresh notes. Deduplication is a UI concern, not a
 * database one.
 */
export const books = pgTable(
  "books",
  {
    id: primaryId().$type<BookId>(),
    userId: userIdColumn(),

    title: text("title").notNull(),
    author: text("author").notNull(),

    /** Nullable: most books are standalone. */
    series: text("series"),
    /** Position within the series. Nullable for the same reason. */
    seriesIndex: integer("series_index"),

    /** Open Library cover URL. Nullable — not every book has cover art. */
    coverUrl: text("cover_url"),

    /**
     * Open Library work key, e.g. "OL45804W". Nullable because a book can be
     * added by hand when Open Library has never heard of it.
     */
    openLibraryId: text("open_library_id"),

    ...timestamps,
  },
  (table) => [
    // Every library query filters by user first. Without this index that is a
    // sequential scan of every user's books.
    index("books_user_id_idx").on(table.userId),
  ],
).enableRLS();
