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
 * What an annotation is attached to.
 *
 * 'region' — a rectangle on the photograph, in normalized coordinates. The
 *   original anchor, and the only one that works on an image.
 * 'text'   — a character range in the page's transcript. Survives reflow,
 *   because reflowing text does not change which characters were chosen.
 *
 * Two anchors rather than one because the two surfaces genuinely differ: a
 * photograph has geometry and a transcript has characters. A rectangle over
 * reflowing text means nothing, and a character offset into a photograph means
 * less.
 */
export const annotationAnchor = pgEnum("annotation_anchor", [
  "region",
  "text",
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

    /**
     * Which surface this is attached to. Everything below is nullable because
     * of it, and the check constraint at the bottom of this table is what stops
     * that nullability from meaning "anything goes".
     */
    anchor: annotationAnchor("anchor").notNull().default("region"),

    /** Left edge, as a fraction of image width. Null for a text anchor. */
    rectX: doublePrecision("rect_x"),
    /** Top edge, as a fraction of image height. Null for a text anchor. */
    rectY: doublePrecision("rect_y"),
    rectWidth: doublePrecision("rect_width"),
    rectHeight: doublePrecision("rect_height"),

    /**
     * Character offsets into the page transcript, half-open: [start, end).
     * Null for a region anchor.
     */
    textStart: integer("text_start"),
    textEnd: integer("text_end"),

    /**
     * The selected text, copied at the moment it was selected.
     *
     * Redundant with the offsets, deliberately. Offsets alone are brittle: if a
     * page is transcribed again and the model reads one word differently, every
     * offset after it shifts and each annotation silently points at the wrong
     * words. The quote is what makes that detectable — and it is what gets
     * displayed, so an annotation still reads correctly even if its offsets
     * have gone stale.
     */
    quotedText: text("quoted_text"),

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

    /**
     * The same three fields as `search_vector`, lowercased and with every run
     * of non-alphanumeric characters flattened to a single space.
     *
     * This exists because full-text search cannot answer every query. A phrase
     * made entirely of stop words — "he just was" — reduces to an empty
     * tsquery and matches nothing, so search also runs a substring match. That
     * substring match used to normalize the text inline in the query, which
     * meant Postgres had to compute it for every row: a sequential scan that
     * discarded the GIN index above, because a leading-wildcard LIKE over a
     * computed expression cannot be indexed.
     *
     * Storing the normalized text makes it indexable. It cannot be an
     * expression index instead: `concat_ws` is STABLE rather than IMMUTABLE,
     * so Postgres rejects it in both index expressions and generated columns.
     * Hence `coalesce` and `||`, which are immutable.
     *
     * Generated, for the same reason `search_vector` is — application code
     * that maintains a derived column is code that eventually forgets to.
     */
    searchText: text("search_text").generatedAlwaysAs(
      sql`regexp_replace(lower(coalesce(user_comment, '') || ' ' || coalesce(extracted_passage, '') || ' ' || coalesce(extracted_context, '')), '[^[:alnum:]]+', ' ', 'g')`,
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

    // A trigram GIN index is what makes `search_text LIKE '%...%'` indexable.
    // It only helps when the pattern contains at least three consecutive
    // literal characters — shorter queries still scan — which is the accepted
    // limit of this approach.
    index("annotations_search_text_trgm_idx").using(
      "gin",
      sql`${table.searchText} gin_trgm_ops`,
    ),

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

    /**
     * Exactly one anchor, fully populated.
     *
     * Making the rectangle nullable to accommodate text annotations opens the
     * door to a row that is neither — no rectangle, no range, attached to
     * nothing. This closes it in the database rather than hoping every code
     * path remembers, which is the same argument as every other constraint in
     * this schema.
     */
    check(
      "annotations_exactly_one_anchor",
      sql`(
        ${table.anchor} = 'region'
        AND ${table.rectX} IS NOT NULL AND ${table.rectY} IS NOT NULL
        AND ${table.rectWidth} IS NOT NULL AND ${table.rectHeight} IS NOT NULL
        AND ${table.textStart} IS NULL AND ${table.textEnd} IS NULL
      ) OR (
        ${table.anchor} = 'text'
        AND ${table.textStart} IS NOT NULL AND ${table.textEnd} IS NOT NULL
        AND ${table.textEnd} > ${table.textStart}
        AND ${table.quotedText} IS NOT NULL
        AND ${table.rectX} IS NULL AND ${table.rectY} IS NULL
        AND ${table.rectWidth} IS NULL AND ${table.rectHeight} IS NULL
      )`,
    ),
  ],
).enableRLS();
