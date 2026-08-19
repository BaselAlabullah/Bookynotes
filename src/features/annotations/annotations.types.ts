import type { annotations } from "@/db/schema";
import type { PageId } from "@/db/ids";

export type Annotation = typeof annotations.$inferSelect;

/** The enum values, derived from the schema rather than retyped. */
export type EnrichmentStatus = Annotation["enrichmentStatus"];

/**
 * A rectangle on a page, as fractions of the image's intrinsic size.
 *
 * This type is the reason the canvas layer in phase 6 can be tested without a
 * browser: everything downstream of the pointer maths speaks in these numbers,
 * and none of it knows what a pixel is.
 */
export type NormalizedRect = {
  /** 0.0 = left edge of the image, 1.0 = right edge. */
  x: number;
  /** 0.0 = top edge of the image, 1.0 = bottom edge. */
  y: number;
  /** Fraction of the image's width. Greater than 0. */
  width: number;
  /** Fraction of the image's height. Greater than 0. */
  height: number;
};

export type NewAnnotation = {
  pageId: PageId;
  rect: NormalizedRect;
  userComment: string;
};

/** What the vision model produced. Written by the enrichment pipeline only. */
export type EnrichmentResult = {
  extractedPassage: string;
  extractedContext: string;
};
