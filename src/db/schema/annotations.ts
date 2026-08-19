import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import type { AnnotationId, PageId } from "@/db/ids";

import { pages } from "./pages";
import { primaryId, timestamps, userIdColumn } from "./shared-columns";
import { tsvector } from "./tsvector";

/**
 * Lifecycle of the vision-model enrichment for one annotation.
 *
 * 'pending'  — written at creation; the model has not been asked yet.
 * 'complete' — passage and context are populated and will never be requested
 *              again. This is the cache that keeps a free tier survivable.
 * 'failed'   — retries exhausted. Terminal until the user asks for a retry.
 */
export const enrichmentStatus = pgEnum("enrichment_status", [
  "pending",
  "complete",
  "failed",
]);

/**
 * A normalized rectangle on a page, the user's note, and whatever the vision
 * model read inside that rectangle.
 *
 * Every coordinate is a fraction of the page image's intrinsic size, in the
 * range 0.0–1.0. Nothing in this table is expressed in pixels, so the same row
 * projects correctly onto a thumbnail, a phone screen and a zoomed canvas.
 */
export const annotations = pgTable(
  "annotations",
  {
    id: primaryId().$type<AnnotationId>(),
    userId: userIdColumn(),

    pageId: uuid("page_id")
      .notNull()
      .$type<PageId>()
      .references(() => pages.id, { onDelete: "cascade" }),

    /** Left edge, as a fraction of image width. */
    rectX: doublePrecision("rect_x").notNull(),
    /** Top edge, as a fraction of image height. */
    rectY: doublePrecision("rect_y").notNull(),
    rectWidth: doublePrecision("rect_width").notNull(),
    rectHeight: doublePrecision("rect_height").notNull(),

    /** The user's own note. Empty string, not null, when they only marked a
     * passage without saying anything about it. */
    userComment: text("user_comment").notNull().default(""),

    /** Transcribed by the vision model. Null until enrichment completes. */
    extractedPassage: text("extracted_passage"),
    /** Surrounding context the model summarised. Null until then too. */
    extractedContext: text("extracted_context"),

    enrichmentStatus: enrichmentStatus("enrichment_status")
      .notNull()
      .default("pending"),
    retryCount: integer("retry_count").notNull().default(0),

    /**
     * Why the last attempt failed. Not in the original data model, added
     * because "retry" is a user-facing action: a 429 the user should wait out
     * and a malformed image they should re-photograph need different words.
     */
    enrichmentError: text("enrichment_error"),

    /**
     * Maintained by Postgres, never written by us — which is the point. A
     * search index that is updated by application code is an index that goes
     * stale the first time someone writes a row from psql.
     *
     * Weighting is decided here because changing it later means a migration:
     * the user's own words rank above the transcribed passage, which ranks
     * above the surrounding context.
     */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(user_comment, '')), 'A') || setweight(to_tsvector('english', coalesce(extracted_passage, '')), 'B') || setweight(to_tsvector('english', coalesce(extracted_context, '')), 'C')`,
    ),

    ...timestamps,
  },
  (table) => [
    index("annotations_user_id_idx").on(table.userId),
    index("annotations_page_id_idx").on(table.pageId),

    // GIN is the right index for tsvector: it indexes every lexeme in the
    // document, which is what makes "find every annotation containing this
    // word" fast. Built now rather than in phase 8 so the column and its index
    // arrive in the same migration.
    index("annotations_search_vector_idx").using("gin", table.searchVector),

    // Coordinates are the one thing in this schema that a bug elsewhere could
    // corrupt silently — a pixel value stored by mistake looks like a valid
    // float. These constraints turn that into an immediate write failure.
    check(
      "annotations_rect_x_normalized",
      sql`${table.rectX} >= 0 AND ${table.rectX} <= 1`,
    ),
    check(
      "annotations_rect_y_normalized",
      sql`${table.rectY} >= 0 AND ${table.rectY} <= 1`,
    ),
    check(
      "annotations_rect_width_normalized",
      sql`${table.rectWidth} > 0 AND ${table.rectWidth} <= 1`,
    ),
    check(
      "annotations_rect_height_normalized",
      sql`${table.rectHeight} > 0 AND ${table.rectHeight} <= 1`,
    ),
    check("annotations_retry_count_positive", sql`${table.retryCount} >= 0`),
  ],
).enableRLS();
