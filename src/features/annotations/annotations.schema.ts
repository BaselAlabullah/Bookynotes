import { z } from "zod";

import { asAnnotationId, asPageId } from "@/db/ids";

export const deleteAnnotationSchema = z.object({
  annotationId: z.uuid().transform(asAnnotationId),
});

/**
 * A rectangle expressed as fractions of the page image's intrinsic size.
 *
 * The bounds are the contract the whole coordinate design rests on: if a pixel
 * value ever reaches here by mistake it will be far greater than 1 and be
 * rejected at the boundary, rather than being stored and quietly rendering a
 * pin somewhere absurd.
 */
export const normalizedRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .refine(
    (rect) =>
      // The epsilon is not sloppiness. These numbers are produced by dividing
      // two floats in the browser, so a rectangle dragged exactly to the edge
      // can land on 1.0000000000000002 and a strict `<= 1` would reject a
      // perfectly good selection.
      rect.x + rect.width <= 1 + 1e-6 && rect.y + rect.height <= 1 + 1e-6,
    { message: "That selection extends past the edge of the page." },
  );

export const createAnnotationSchema = z.object({
  pageId: z.uuid().transform(asPageId),
  rect: normalizedRectSchema,
  userComment: z
    .string()
    .trim()
    .max(2000, "Keep a note under 2000 characters.")
    // An empty comment is allowed: marking a passage without saying anything
    // about it is a real thing people do, and the model still has work to do.
    .default(""),
});

export type CreateAnnotationInput = z.infer<typeof createAnnotationSchema>;

/**
 * A selection in the page transcript.
 *
 * The offsets are what anchor it; the quote is what makes a stale anchor
 * detectable and is what gets displayed. Both are required — see the check
 * constraint on the table, which enforces the same thing one layer down.
 */
export const createTextAnnotationSchema = z
  .object({
    pageId: z.uuid().transform(asPageId),
    /** Half-open character range into the transcript: [start, end). */
    textStart: z.number().int().min(0),
    textEnd: z.number().int().min(1),
    quotedText: z
      .string()
      .min(1, "Select some text first.")
      // A whole page is a few thousand characters; well past that and something
      // has gone wrong with the selection rather than with the reader.
      .max(10_000, "That selection is too long."),
    userComment: z.string().trim().max(2000).default(""),
  })
  .refine((value) => value.textEnd > value.textStart, {
    message: "That selection is empty.",
  });

export type CreateTextAnnotationInput = z.infer<
  typeof createTextAnnotationSchema
>;

export const updateAnnotationSchema = z.object({
  annotationId: z.uuid().transform(asAnnotationId),
  userComment: z.string().trim().max(2000).default(""),
  extractedPassage: z.string().trim().max(10_000).default(""),
  extractedContext: z.string().trim().max(10_000).default(""),
});

export type UpdateAnnotationInput = z.infer<typeof updateAnnotationSchema>;

export type CreateAnnotationResult = {
  error: string | null;
  createdId: string | null;
};

export type UpdateAnnotationResult = {
  error: string | null;
};

/**
 * The envelope the enrichment endpoint returns. Parsed rather than cast: JSON
 * crossing a network is `unknown` regardless of who wrote the endpoint.
 */
export const enrichResponseSchema = z.object({
  status: z.enum(["complete", "cached", "retryable", "failed"]).optional(),
  error: z.string().optional(),
});
