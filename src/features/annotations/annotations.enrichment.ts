import type { AnnotationId, UserId } from "@/db/ids";
import { findPage } from "@/features/pages/pages.repository";
import { createSignedRead } from "@/integrations/storage/storage.client";
import { extractPassage } from "@/integrations/vision/vision.client";
import {
  VisionPermanentError,
  VisionRateLimitError,
} from "@/integrations/vision/vision.types";

import {
  completeEnrichment,
  findAnnotation,
  recordEnrichmentFailure,
  resetEnrichment,
} from "./annotations.repository";
import { prepareCropForModel } from "./annotations.crop";
import type { Annotation } from "./annotations.types";

/**
 * The enrichment pipeline: the only place the vision model is called.
 *
 * It runs in its own request, never as part of creating an annotation, so a
 * slow or rate-limited model can never delay or fail a write the user has
 * already made.
 */

/**
 * How many failed attempts before an annotation is declared 'failed'.
 *
 * Failure is not permanent even then — the user can ask again, and asking again
 * resets the count. This number only decides when to stop trying on our own and
 * put the decision in front of them.
 */
const MAX_ATTEMPTS = 3;

export type EnrichmentOutcome =
  | { status: "complete"; annotation: Annotation }
  /** Already enriched. The model was not called. */
  | { status: "cached"; annotation: Annotation }
  | { status: "not-found" }
  /** Failed, but worth trying again — rate limits and blips land here. */
  | { status: "retryable"; message: string; annotation: Annotation | null }
  /** Out of attempts, or a failure that will never succeed. */
  | { status: "failed"; message: string; annotation: Annotation | null };

export async function enrichAnnotation(
  userId: UserId,
  annotationId: AnnotationId,
  options: { force?: boolean } = {},
): Promise<EnrichmentOutcome> {
  const annotation = await findAnnotation(userId, annotationId);

  if (!annotation) {
    return { status: "not-found" };
  }

  // The cache, and the reason a free tier survives this app at all: the same
  // region is never sent to the model twice. `force` exists only for the user's
  // own "try again" on a failed row, which is the one case where re-asking is
  // what they want.
  if (annotation.enrichmentStatus === "complete" && !options.force) {
    return { status: "cached", annotation };
  }

  const page = await findPage(userId, annotation.pageId);

  if (!page) {
    return { status: "not-found" };
  }

  // A user asking again is a fresh decision, not a continuation of our own
  // automatic attempts, so the budget starts over.
  if (options.force) {
    await resetEnrichment(userId, annotationId);
  }

  const attemptsSoFar = options.force ? 0 : annotation.retryCount;

  try {
    // Enrichment is the one place image bytes pass through this server, and it
    // is unavoidable: the model needs pixels, and the crop must be one we
    // produced rather than one a client handed us. See DECISIONS 0039.
    const signed = await createSignedRead(page.storageKey);
    const response = await fetch(signed.url);

    if (!response.ok) {
      return await fail(
        userId,
        annotationId,
        `The page image could not be read (${response.status}).`,
        attemptsSoFar,
        false,
      );
    }

    const pageImage = Buffer.from(await response.arrayBuffer());

    const crop = await prepareCropForModel(pageImage, {
      x: annotation.rectX,
      y: annotation.rectY,
      width: annotation.rectWidth,
      height: annotation.rectHeight,
    });

    const result = await extractPassage(crop);

    const updated = await completeEnrichment(userId, annotationId, {
      extractedPassage: result.passage,
      extractedContext: result.context,
    });

    if (!updated) {
      return { status: "not-found" };
    }

    return { status: "complete", annotation: updated };
  } catch (error) {
    if (error instanceof VisionRateLimitError) {
      // A quota wall is not the annotation's fault, so it does not consume the
      // attempt budget — otherwise a bad afternoon on the free tier would mark
      // perfectly good annotations permanently failed.
      const updated = await recordEnrichmentFailure(
        userId,
        annotationId,
        "The model is rate limited right now. Try again shortly.",
        false,
      );

      return {
        status: "retryable",
        message: "The model is rate limited right now. Try again shortly.",
        annotation: updated,
      };
    }

    const message =
      error instanceof Error ? error.message : "Extraction failed.";

    return await fail(
      userId,
      annotationId,
      message,
      attemptsSoFar,
      error instanceof VisionPermanentError,
    );
  }
}

/**
 * Record a failed attempt and decide whether this is the end of the road.
 *
 * A permanent error terminates immediately: a rejected image or a bad API key
 * will fail identically on every future attempt, and pretending otherwise just
 * makes the user click "try again" twice more for nothing.
 */
async function fail(
  userId: UserId,
  annotationId: AnnotationId,
  message: string,
  attemptsSoFar: number,
  isPermanent: boolean,
): Promise<EnrichmentOutcome> {
  const isTerminal = isPermanent || attemptsSoFar + 1 >= MAX_ATTEMPTS;

  const updated = await recordEnrichmentFailure(
    userId,
    annotationId,
    message,
    isTerminal,
  );

  return isTerminal
    ? { status: "failed", message, annotation: updated }
    : { status: "retryable", message, annotation: updated };
}
