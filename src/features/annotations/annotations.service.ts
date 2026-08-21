import type { UserId } from "@/db/ids";
import { findPage } from "@/features/pages/pages.repository";

import {
  findAnnotation,
  insertAnnotation,
  insertTextAnnotation,
  updateAnnotationContent,
} from "./annotations.repository";
import { contextAround, rangeStillMatches } from "./annotations.text";
import type { UpdateAnnotationInput } from "./annotations.schema";
import type {
  Annotation,
  NewAnnotation,
  NewTextAnnotation,
} from "./annotations.types";

/**
 * Create an annotation on a page the user owns.
 *
 * Same shape as `pages.service.createPage`, and for the same reason: the
 * repository cannot check a parent it is not allowed to read.
 *
 * This function returns as soon as the row is written. It does not call the
 * vision model, does not await anything slow, and has no idea that enrichment
 * exists — the row leaves here with `enrichment_status = 'pending'` and phase 7
 * picks it up from a separate request.
 */
export async function createAnnotation(
  userId: UserId,
  input: NewAnnotation,
): Promise<Annotation | null> {
  const page = await findPage(userId, input.pageId);

  if (!page) {
    return null;
  }

  return insertAnnotation(userId, input);
}

export type CreateTextAnnotationResult =
  | { status: "created"; annotation: Annotation }
  /** The page is missing, or is not this user's. The same answer for both. */
  | { status: "not-found" }
  /** Nothing has been transcribed, so there is nothing to anchor to. */
  | { status: "no-transcript" }
  /** The offsets no longer cover the words that were selected. */
  | { status: "stale-selection" };

/**
 * Create an annotation anchored to a range of the page's transcript.
 *
 * The ownership check is the same as for a region annotation. What is different
 * is the validation *against the transcript itself*: the offsets and the quote
 * are checked to still agree before anything is written.
 *
 * That check matters because the client sent all three. Offsets from a stale
 * tab, or from a transcript that has since been re-read, would otherwise be
 * stored as though they were current — and an annotation quietly pointing at
 * the wrong words is worse than one that failed to save.
 */
export async function createTextAnnotation(
  userId: UserId,
  input: NewTextAnnotation,
): Promise<CreateTextAnnotationResult> {
  const page = await findPage(userId, input.pageId);

  if (!page) {
    return { status: "not-found" };
  }

  if (!page.transcript) {
    return { status: "no-transcript" };
  }

  if (
    !rangeStillMatches(
      page.transcript,
      input.textStart,
      input.textEnd,
      input.quotedText,
    )
  ) {
    return { status: "stale-selection" };
  }

  const annotation = await insertTextAnnotation(
    userId,
    input,
    contextAround(page.transcript, input.textStart, input.textEnd),
  );

  return { status: "created", annotation };
}

export type UpdateAnnotationResult =
  | { status: "updated"; annotation: Annotation }
  /** The annotation is missing, or is not this user's. */
  | { status: "not-found" };

export async function updateAnnotation(
  userId: UserId,
  input: UpdateAnnotationInput,
): Promise<UpdateAnnotationResult> {
  const annotation = await findAnnotation(userId, input.annotationId);

  if (!annotation) {
    return { status: "not-found" };
  }

  const extractedPassage = input.extractedPassage.trim() || null;
  const extractedContext = input.extractedContext.trim() || null;
  const hasExtraction = extractedPassage !== null || extractedContext !== null;
  const updated = await updateAnnotationContent(userId, input.annotationId, {
    userComment: input.userComment,
    extractedPassage,
    extractedContext,
    enrichmentStatus: hasExtraction ? "complete" : annotation.enrichmentStatus,
  });

  return updated ? { status: "updated", annotation: updated } : { status: "not-found" };
}
