import { z } from "zod";

import { asBookId, asPageId } from "@/db/ids";

export const deletePageSchema = z.object({
  pageId: z.uuid().transform(asPageId),
});

import { ACCEPTED_CONTENT_TYPES } from "./pages.storage-key";

/**
 * Ids are branded here, at the boundary, exactly where an untrusted string is
 * checked. `z.uuid()` proves the shape and `asBookId` applies the brand, so
 * everything downstream receives a `BookId` that could only have come through
 * a validation step.
 */
const bookIdSchema = z.uuid().transform(asBookId);

/** Step one: ask for somewhere to put a file. */
export const uploadTargetSchema = z.object({
  bookId: bookIdSchema,
  contentType: z.enum(
    ACCEPTED_CONTENT_TYPES as [string, ...string[]],
    "Only JPEG, PNG and WebP images are accepted.",
  ),
});

/**
 * A point on the page, as fractions of the image's intrinsic size.
 *
 * The same 0..1 space every annotation rectangle uses. A pixel value arriving
 * here would be far greater than 1 and refused at the boundary rather than
 * stored — the discipline from DECISIONS 0031, applied to a second kind of
 * coordinate.
 */
const normalizedPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

/**
 * The page corners the reader placed by hand.
 *
 * Exactly four, in any order: they are sorted into top-left, top-right,
 * bottom-right, bottom-left by the processor, because dragging handles produces
 * whatever order the user happened to touch them in.
 */
export const pageCornersSchema = z.tuple([
  normalizedPointSchema,
  normalizedPointSchema,
  normalizedPointSchema,
  normalizedPointSchema,
]);

export type PageCorners = z.infer<typeof pageCornersSchema>;

/**
 * Step two: the file is uploaded, record the page.
 *
 * `imageWidth` and `imageHeight` are measured by the browser, because the app
 * server never sees the bytes — that is the whole design. They are therefore
 * client-reported and cannot be verified here. The blast radius is contained:
 * wrong dimensions distort only that user's own annotation coordinates on their
 * own page, and the database still rejects anything non-positive.
 */
export const completeUploadSchema = z.object({
  bookId: bookIdSchema,
  pageNumber: z
    .number()
    .int("Page numbers are whole numbers.")
    // Signed on purpose: roman-numeral front matter is better modelled as zero
    // or negative than invented.
    .min(-999)
    .max(99_999),
  storageKey: z.string().min(1).max(300),
  imageWidth: z.number().int().positive().max(50_000),
  imageHeight: z.number().int().positive().max(50_000),

  /**
   * Where the reader says the page is. Optional: without it the processor
   * falls back to finding the page itself, which works for a flat page on a
   * contrasting surface and not much else.
   */
  corners: pageCornersSchema.optional(),
});

export type UploadTargetInput = z.infer<typeof uploadTargetSchema>;
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;

/**
 * Responses the browser has to read back. JSON crossing a network is `unknown`
 * regardless of who wrote the endpoint, so these are parsed rather than cast.
 */
export const uploadTargetResponseSchema = z.object({
  url: z.url(),
  token: z.string().min(1),
  storageKey: z.string().min(1),
});

export const apiErrorSchema = z.object({ error: z.string() });
