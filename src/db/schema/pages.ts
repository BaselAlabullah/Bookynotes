import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type { BookId, PageId } from "@/db/ids";

/** A point on the page, as fractions of the image's intrinsic size. */
type Point = { x: number; y: number };

import { enrichmentStatus } from "./annotations";
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
     * The four page corners the reader placed by hand, as fractions of the
     * *uploaded* photograph.
     *
     * Kept for the same reason `original_storage_key` is: with both, the
     * flattening can be redone or adjusted without asking anybody to drag the
     * handles again. Null when the corners were detected automatically, or when
     * nothing was flattened at all.
     *
     * Normalized, like every other coordinate in this project. Pixels are never
     * stored - see DECISIONS 0031.
     */
    pageCorners: jsonb("page_corners").$type<[Point, Point, Point, Point]>(),

    /**
     * The photograph exactly as it was uploaded, when the page-processor has
     * replaced it with a flattened version.
     *
     * Null means `storage_key` *is* the original — either the processor was not
     * running, or it could not find a page in the picture. Keeping the source
     * means the flattening can be re-run later with a better detector, and that
     * a bad rectification is recoverable rather than permanent.
     */
    originalStorageKey: text("original_storage_key"),

    /**
     * A small derived copy, for grids and filmstrips. Nullable because it is
     * generated after the upload and that generation is allowed to fail: a
     * missing thumbnail costs bandwidth, a missing page costs the annotation.
     * Readers fall back to the full image.
     */
    thumbnailStorageKey: text("thumbnail_storage_key"),

    /**
     * The whole page as readable text, produced by the vision model.
     *
     * Null until somebody asks for it. Transcription is a separate request from
     * the upload for the same reason enrichment is (DECISIONS 0025): a write
     * must never wait on a model, and a page is perfectly usable without one.
     *
     * The photograph stays canonical. This is a second view of the same page,
     * never a replacement — a transcript is what a model *believed* it read, and
     * the picture is the only thing that can settle an argument about a name or
     * an unusual word.
     */
    transcript: text("transcript"),

    /** Reuses the annotation lifecycle enum: the three states are the same. */
    transcriptStatus: enrichmentStatus("transcript_status"),

    /** Why the last attempt failed, for a user-visible retry. */
    transcriptError: text("transcript_error"),

    /**
     * The page number the model read off the page, when transcribing.
     *
     * An integrity check, not a display value. We already know which page the
     * reader filed this as; a disagreement means either a mistyped page number
     * or a model that read something other than what is in front of it. Neither
     * is worth failing over, and both are worth saying out loud.
     */
    transcriptPageNumber: text("transcript_page_number"),

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
