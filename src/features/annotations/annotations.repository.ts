import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db, type DatabaseTransaction } from "@/db/client";
import type { AnnotationId, PageId, UserId } from "@/db/ids";
import { annotations } from "@/db/schema";

import type {
  Annotation,
  EnrichmentResult,
  NewAnnotation,
  NewTextAnnotation,
  NormalizedRect,
} from "./annotations.types";

type AnnotationContentUpdate = {
  userComment: string;
  extractedPassage: string | null;
  extractedContext: string | null;
  enrichmentStatus: Annotation["enrichmentStatus"];
};

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

/**
 * Create an annotation anchored to a range of the page transcript.
 *
 * Born `complete` rather than `pending`, and that is the point: the reader
 * selected the words, so `extracted_passage` *is* the selection. There is
 * nothing for a vision model to read, and on a free tier of twenty calls a day
 * that difference is the difference between a feature you can use and one you
 * ration.
 */
export async function insertTextAnnotation(
  userId: UserId,
  input: NewTextAnnotation,
  /** Surrounding transcript, for context. Computed locally, not by a model. */
  context: string,
): Promise<Annotation> {
  const [created] = await db
    .insert(annotations)
    .values({
      userId,
      pageId: input.pageId,
      anchor: "text",
      textStart: input.textStart,
      textEnd: input.textEnd,
      quotedText: input.quotedText,
      userComment: input.userComment,
      extractedPassage: input.quotedText,
      extractedContext: context,
      enrichmentStatus: "complete",
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

export async function updateRegionAnnotationRects(
  transaction: DatabaseTransaction,
  userId: UserId,
  pageId: PageId,
  updates: Array<{ annotationId: AnnotationId; rect: NormalizedRect }>,
): Promise<boolean> {
  for (const update of updates) {
    const changed = await transaction
      .update(annotations)
      .set({
        rectX: update.rect.x,
        rectY: update.rect.y,
        rectWidth: update.rect.width,
        rectHeight: update.rect.height,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(annotations.id, update.annotationId),
          eq(annotations.pageId, pageId),
          eq(annotations.userId, userId),
          eq(annotations.anchor, "region"),
        ),
      )
      .returning({ id: annotations.id });

    if (changed.length !== 1) return false;
  }

  return true;
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

/**
 * Put a failed annotation back in the queue.
 *
 * The retry count is reset, not incremented: the user asking again is a new
 * decision, not a continuation of our automatic attempts. Without this, a
 * failure during a rate-limited afternoon would leave the row one attempt from
 * being permanently dead the next time it was touched.
 */
export async function resetEnrichment(
  userId: UserId,
  annotationId: AnnotationId,
): Promise<Annotation | null> {
  const [updated] = await db
    .update(annotations)
    .set({
      enrichmentStatus: "pending",
      retryCount: 0,
      enrichmentError: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(annotations.id, annotationId), eq(annotations.userId, userId)),
    )
    .returning();

  return updated ?? null;
}

export async function updateAnnotationContent(
  userId: UserId,
  annotationId: AnnotationId,
  input: AnnotationContentUpdate,
): Promise<Annotation | null> {
  const [updated] = await db
    .update(annotations)
    .set({
      userComment: input.userComment,
      extractedPassage: input.extractedPassage,
      extractedContext: input.extractedContext,
      enrichmentStatus: input.enrichmentStatus,
      enrichmentError: null,
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

export async function countAnnotationsForPages(
  userId: UserId,
  pageIds: PageId[],
): Promise<Map<PageId, number>> {
  if (pageIds.length === 0) return new Map();

  const rows = await db
    .select({ pageId: annotations.pageId, count: sql<number>`count(*)::int` })
    .from(annotations)
    .where(
      and(eq(annotations.userId, userId), inArray(annotations.pageId, pageIds)),
    )
    .groupBy(annotations.pageId);

  return new Map(rows.map((row) => [row.pageId, row.count]));
}

export type AnnotationStatusCounts = {
  annotationCount: number;
  pendingPassageCount: number;
  failedPassageCount: number;
  completePassageCount: number;
};

export async function countAnnotationStatusesForPages(
  userId: UserId,
  pageIds: PageId[],
): Promise<Map<PageId, AnnotationStatusCounts>> {
  if (pageIds.length === 0) return new Map();

  const rows = await db
    .select({
      pageId: annotations.pageId,
      annotationCount: sql<number>`count(*)::int`,
      pendingPassageCount: sql<number>`(
        count(*) filter (
          where ${annotations.anchor} = 'region'
          and ${annotations.enrichmentStatus} = 'pending'
        )
      )::int`,
      failedPassageCount: sql<number>`(
        count(*) filter (
          where ${annotations.anchor} = 'region'
          and ${annotations.enrichmentStatus} = 'failed'
        )
      )::int`,
      completePassageCount: sql<number>`(
        count(*) filter (
          where ${annotations.anchor} = 'region'
          and ${annotations.enrichmentStatus} = 'complete'
        )
      )::int`,
    })
    .from(annotations)
    .where(
      and(eq(annotations.userId, userId), inArray(annotations.pageId, pageIds)),
    )
    .groupBy(annotations.pageId);

  return new Map(
    rows.map((row) => [
      row.pageId,
      {
        annotationCount: row.annotationCount,
        pendingPassageCount: row.pendingPassageCount,
        failedPassageCount: row.failedPassageCount,
        completePassageCount: row.completePassageCount,
      },
    ]),
  );
}
