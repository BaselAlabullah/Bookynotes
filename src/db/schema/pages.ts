import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import type { BookId, PageId } from "@/db/ids";

import { books } from "./books";
import { primaryId, timestamps, userIdColumn } from "./shared-columns";

/**
 * A photographed page belonging to a book.
 *
 * `imageWidth` and `imageHeight` are the intrinsic pixel dimensions of the
 * uploaded file. They are the denominator for every annotation rectangle on
 * this page, which is why they are NOT NULL: a rectangle on a page of unknown
 * size cannot be projected back onto anything.
 */
export const pages = pgTable(
  "pages",
  {
    id: primaryId().$type<PageId>(),
    userId: userIdColumn(),

    bookId: uuid("book_id")
      .notNull()
      .$type<BookId>()
      .references(() => books.id, { onDelete: "cascade" }),

    /** As printed in the book. Signed, because roman-numeral front matter is
     * sometimes best modelled as negative or zero rather than invented. */
    pageNumber: integer("page_number").notNull(),

    /**
     * Path within the private Storage bucket, e.g. "<userId>/<pageId>.jpg".
     * Never a URL: URLs to a private bucket are signed and expire, so storing
     * one would mean storing something that stops working.
     */
    storageKey: text("storage_key").notNull(),

    imageWidth: integer("image_width").notNull(),
    imageHeight: integer("image_height").notNull(),

    /**
     * A small derived copy, for grids and filmstrips. Nullable because it is
     * generated after the upload and that generation is allowed to fail: a
     * missing thumbnail costs bandwidth, a missing page costs the annotation.
     * Readers fall back to the full image.
     */
    thumbnailStorageKey: text("thumbnail_storage_key"),

    ...timestamps,
  },
  (table) => [
    // The same page of the same book cannot be uploaded twice. This is the
    // constraint the upload flow relies on to be idempotent under a retry.
    unique("pages_book_id_page_number_key").on(table.bookId, table.pageNumber),

    index("pages_user_id_idx").on(table.userId),
    index("pages_book_id_idx").on(table.bookId),

    // Dimensions come from the browser reading the file it just picked, which
    // means they are client-supplied and therefore not trusted.
    check("pages_image_width_positive", sql`${table.imageWidth} > 0`),
    check("pages_image_height_positive", sql`${table.imageHeight} > 0`),
  ],
).enableRLS();
