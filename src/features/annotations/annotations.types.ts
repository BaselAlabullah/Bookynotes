import type { annotations } from "@/db/schema";
import type { PageId } from "@/db/ids";

export type Annotation = typeof annotations.$inferSelect;

/**
 * An annotation that really is a rectangle on the photograph.
 *
 * The columns are nullable in the schema because a text annotation has no
 * rectangle, but the check constraint guarantees a region anchor has all four.
 * This narrows that guarantee back into the type system, so the canvas can use
 * the numbers without four non-null assertions apologising for a database rule
 * it cannot see.
 */
export type RegionAnnotation = Annotation & {
  anchor: "region";
  rectX: number;
  rectY: number;
  rectWidth: number;
  rectHeight: number;
};

export function isRegionAnnotation(
  annotation: Annotation,
): annotation is RegionAnnotation {
  return annotation.anchor === "region" && annotation.rectX !== null;
}

/** An annotation anchored to a character range in the page transcript. */
export type TextAnnotation = Annotation & {
  anchor: "text";
  textStart: number;
  textEnd: number;
  quotedText: string;
};

export function isTextAnnotation(
  annotation: Annotation,
): annotation is TextAnnotation {
  return (
    annotation.anchor === "text" &&
    annotation.textStart !== null &&
    annotation.textEnd !== null &&
    annotation.quotedText !== null
  );
}

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

/** A selection in a page transcript, with the words it covered. */
export type NewTextAnnotation = {
  pageId: PageId;
  textStart: number;
  textEnd: number;
  quotedText: string;
  userComment: string;
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
