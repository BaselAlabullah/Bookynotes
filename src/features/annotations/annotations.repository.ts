import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { AnnotationId, PageId, UserId } from "@/db/ids";
import { annotations } from "@/db/schema";

import type { Annotation, EnrichmentResult, NewAnnotation } from "./annotations.types";

/**
 * Every query against the `annotations` table.
 *
 * As with pages, the page-ownership check is not here — it belongs to
 * `annotations.service.ts`, which can read the `pages` table.
 */

export async function insertAnnotation(
  userId: UserId,
  input: NewAnnotation,
): Promise<Annotation> {
  const [created] = await db
    .insert(annotations)
    .values({
      userId,
      pageId: input.pageId,
      rectX: input.rect.x,
      rectY: input.rect.y,
      rectWidth: input.rect.width,
      rectHeight: input.rect.height,
      userComment: input.userComment,
      // Status is not a parameter. An annotation is always born 'pending':
      // there is no code path that creates one already enriched, because the
      // write must never wait on the model.
    })
    .returning();

  if (!created) {
    throw new Error("Insert into annotations returned no row");
  }

  return created;
}

export async function listAnnotationsForPage(
  userId: UserId,
  pageId: PageId,
): Promise<Annotation[]> {
  return db
    .select()
    .from(annotations)
    .where(and(eq(annotations.pageId, pageId), eq(annotations.userId, userId)))
    .orderBy(asc(annotations.createdAt));
}

export async function findAnnotation(
  userId: UserId,
  annotationId: AnnotationId,
): Promise<Annotation | null> {
  const [annotation] = await db
    .select()
    .from(annotations)
    .where(
      and(eq(annotations.id, annotationId), eq(annotations.userId, userId)),
    )
    .limit(1);

  return annotation ?? null;
}

/**
 * Record a successful enrichment. Terminal: `enrichment_status = 'complete'` is
 * what stops this region ever being sent to the model again, which is the
 * whole cache.
 */
export async function completeEnrichment(
  userId: UserId,
  annotationId: AnnotationId,
  result: EnrichmentResult,
): Promise<Annotation | null> {
  const [updated] = await db
    .update(annotations)
    .set({
      extractedPassage: result.extractedPassage,
      extractedContext: result.extractedContext,
      enrichmentStatus: "complete",
      enrichmentError: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(annotations.id, annotationId), eq(annotations.userId, userId)),
    )
    .returning();

  return updated ?? null;
}

/**
 * Record a failed attempt.
 *
 * `retryCount` is incremented in SQL rather than read-then-written, so two
 * concurrent attempts cannot both read 1 and both write 2. The status only
 * moves to 'failed' when the caller says the retries are exhausted; until then
 * it stays 'pending' and remains eligible for another attempt.
 */
export async function recordEnrichmentFailure(
  userId: UserId,
  annotationId: AnnotationId,
  reason: string,
  isTerminal: boolean,
): Promise<Annotation | null> {
  const [updated] = await db
    .update(annotations)
    .set({
      retryCount: sql`${annotations.retryCount} + 1`,
      enrichmentError: reason,
      enrichmentStatus: isTerminal ? "failed" : "pending",
      updatedAt: new Date(),
    })
    .where(
      and(eq(annotations.id, annotationId), eq(annotations.userId, userId)),
    )
    .returning();

  return updated ?? null;
}

export async function deleteAnnotation(
  userId: UserId,
  annotationId: AnnotationId,
): Promise<boolean> {
  const deleted = await db
    .delete(annotations)
    .where(
      and(eq(annotations.id, annotationId), eq(annotations.userId, userId)),
    )
    .returning({ id: annotations.id });

  return deleted.length > 0;
}
