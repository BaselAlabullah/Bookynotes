import { isUniqueViolation } from "@/db/errors";
import { db } from "@/db/client";
import type { PageId, UserId } from "@/db/ids";
import {
  countAnnotationStatusesForPages,
  countAnnotationsForPages,
  listAnnotationsForPage,
  type AnnotationStatusCounts,
  updateRegionAnnotationRects,
} from "@/features/annotations/annotations.repository";
import { isRegionAnnotation } from "@/features/annotations/annotations.types";
import { findBook } from "@/features/books/books.repository";
import {
  isPageProcessorConfigured,
  rectifyPage,
} from "@/integrations/page-processor/page-processor.client";
import {
  createSignedRead,
  createSignedUpload,
  objectExists,
  removeObject,
  removeObjects,
  uploadObject,
} from "@/integrations/storage/storage.client";
import type { SignedUpload } from "@/integrations/storage/storage.types";

import {
  deletePage,
  findPage,
  insertPage,
  updatePageGeometry,
} from "./pages.repository";
import type {
  CompleteUploadInput,
  UpdatePageCornersInput,
  UploadTargetInput,
} from "./pages.schema";
import { remapRectBetweenPageCrops } from "./pages.projection";
import { buildStorageKey, isStorageKeyOwnedBy } from "./pages.storage-key";
import {
  flattenedKeyFor,
  revisedFlattenedKeyFor,
} from "./pages.storage-key";
import { buildThumbnail, thumbnailKeyFor } from "./pages.thumbnail";
import type { Page } from "./pages.types";

/**
 * Uploading a page happens in two requests, and the order is deliberate.
 *
 *   1. `prepareUpload` — we check the book is yours and hand back a signed URL.
 *      No database row is written.
 *   2. the browser PUTs the file straight to Supabase.
 *   3. `completeUpload` — we confirm the object is really there, then write the
 *      row.
 *
 * The alternative, writing the row first, is worse: an abandoned upload would
 * leave a page row pointing at nothing, and every reader downstream would have
 * to cope with a page that cannot be displayed. This way the failure mode is an
 * orphaned object in a bucket — invisible, harmless, and cheap to sweep — while
 * a `pages` row always means an image exists.
 */

/** Step one. Null when the book does not exist or is not this user's. */
export async function prepareUpload(
  userId: UserId,
  input: UploadTargetInput,
): Promise<SignedUpload | null> {
  const book = await findBook(userId, input.bookId);

  if (!book) {
    return null;
  }

  return createSignedUpload(
    buildStorageKey(userId, input.bookId, input.contentType),
  );
}

export type CompleteUploadResult =
  | { status: "created"; page: Page }
  /** The book is missing, or is not this user's. The same answer for both. */
  | { status: "not-found" }
  /** The upload never landed, so there is nothing to point a row at. */
  | { status: "missing-object" }
  /** That page number is already taken in this book. */
  | { status: "duplicate-page" };

/**
 * Step three. Returns a result rather than throwing, because every one of these
 * outcomes is ordinary and each maps to a different thing to tell the user.
 */
export async function completeUpload(
  userId: UserId,
  input: CompleteUploadInput,
): Promise<CompleteUploadResult> {
  const book = await findBook(userId, input.bookId);

  if (!book) {
    return { status: "not-found" };
  }

  // The client chose this string, so it is checked against the prefix the
  // server would have issued rather than trusted. Without this, a signed-in
  // user could point a page row of their own at another user's object.
  if (!isStorageKeyOwnedBy(input.storageKey, userId, input.bookId)) {
    return { status: "not-found" };
  }

  if (!(await objectExists(input.storageKey))) {
    return { status: "missing-object" };
  }

  // The bytes are read once here and reused for everything that follows: the
  // flattening, the thumbnail, and the dimensions. Each of those used to fetch
  // the object separately.
  const uploaded = await tryReadObject(input.storageKey);

  if (!uploaded) {
    return { status: "missing-object" };
  }

  // Flatten the page, if a processor is running. When it is not — the normal
  // case on the deployed instance — `canonical` is simply what was uploaded and
  // nothing downstream can tell the difference.
  const canonical = await tryRectify(uploaded, input.storageKey, input.corners);

  const thumbnailStorageKey = await tryBuildThumbnail(
    canonical.bytes,
    canonical.storageKey,
  );

  try {
    const page = await insertPage(userId, {
      bookId: input.bookId,
      pageNumber: input.pageNumber,
      storageKey: canonical.storageKey,
      originalStorageKey: canonical.originalStorageKey,
      // Recorded only when the reader actually placed them and the flattening
      // used them, so the row never claims corners that produced nothing.
      pageCorners: canonical.originalStorageKey ? (input.corners ?? null) : null,
      // Overridden only when we re-encoded the image ourselves. Left as the
      // browser reported it otherwise, because sharp reads dimensions *before*
      // EXIF rotation is applied and a browser reports them after — so
      // "correcting" an untouched phone photo would silently transpose a
      // portrait page. The processor's output carries no EXIF, so its numbers
      // are unambiguous.
      imageWidth: canonical.width ?? input.imageWidth,
      imageHeight: canonical.height ?? input.imageHeight,
      thumbnailStorageKey,
    });

    return { status: "created", page };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    // The unique constraint on (book_id, page_number) rejected this. Letting
    // the database decide is what makes two simultaneous uploads of page 12
    // safe; a read-then-write check here would let both through.
    //
    // Everything written for this page now belongs to no row, so remove all of
    // it rather than leave litter behind.
    const orphans = [
      input.storageKey,
      canonical.storageKey,
      canonical.originalStorageKey,
      thumbnailStorageKey,
    ].filter((key): key is string => key !== null);

    for (const key of new Set(orphans)) {
      await removeObject(key);
    }

    return { status: "duplicate-page" };
  }
}

/** Read an uploaded object back, or null when it cannot be read. */
async function tryReadObject(storageKey: string): Promise<Buffer | null> {
  try {
    const signed = await createSignedRead(storageKey);
    const response = await fetch(signed.url);

    if (!response.ok) {
      return null;
    }

    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

type CanonicalImage = {
  bytes: Buffer;
  storageKey: string;
  /** Set only when a flattened version replaced the upload. */
  originalStorageKey: string | null;
  /** Set only when we produced the bytes and therefore know their size. */
  width: number | null;
  height: number | null;
};

/**
 * Flatten the page, or hand back what was uploaded.
 *
 * When the processor succeeds the flattened image becomes canonical and the
 * photograph is kept beside it. Doing that *here* — before the row exists, and
 * so before any annotation can exist — is what makes it safe. Changing the
 * geometry of an image that already has rectangles anchored to it would move
 * every one of them.
 *
 * Every failure path returns the upload unchanged. The processor not running is
 * the ordinary case, not an error.
 */
async function tryRectify(
  uploaded: Buffer,
  storageKey: string,
  corners?: readonly { x: number; y: number }[],
): Promise<CanonicalImage> {
  const untouched: CanonicalImage = {
    bytes: uploaded,
    storageKey,
    originalStorageKey: null,
    width: null,
    height: null,
  };

  if (!isPageProcessorConfigured()) {
    return untouched;
  }

  try {
    const flattenedKey = flattenedKeyFor(storageKey);
    const result = await rectifyPage(storageKey, flattenedKey, corners);

    // Null means unreachable or refused. `rectified: false` means it looked and
    // found no page, so there is no derived geometry worth a second object and
    // a second key.
    if (!result || !result.rectified) {
      await removeObject(flattenedKey).catch(() => undefined);
      return untouched;
    }

    const flattened = await tryReadObject(flattenedKey);

    if (!flattened) {
      await removeObject(flattenedKey).catch(() => undefined);
      return untouched;
    }

    return {
      bytes: flattened,
      storageKey: flattenedKey,
      originalStorageKey: storageKey,
      width: result.width,
      height: result.height,
    };
  } catch {
    await removeObject(flattenedKeyFor(storageKey)).catch(() => undefined);
    return untouched;
  }
}

/**
 * Produce and store a thumbnail, or give up quietly.
 *
 * This is the one write path where the server reads the image bytes it told the
 * browser to upload directly. That is a deliberate exception, the same one
 * enrichment makes (DECISIONS 0039), and it is confined to a single fetch on a
 * single request. Every read afterwards is cheaper for it.
 */
async function tryBuildThumbnail(
  bytes: Buffer,
  storageKey: string,
): Promise<string | null> {
  try {
    const thumbnail = await buildThumbnail(bytes);
    const thumbnailKey = thumbnailKeyFor(storageKey);

    await uploadObject(thumbnailKey, thumbnail, "image/jpeg");

    return thumbnailKey;
  } catch {
    return null;
  }
}

export type UpdatePageCornersResult =
  | { status: "updated"; page: Page; cleanupIncomplete: boolean }
  | { status: "not-found" }
  | { status: "processor-unavailable" }
  | { status: "source-unreadable" }
  | { status: "processing-failed" }
  | { status: "annotations-cannot-be-remapped" }
  | { status: "update-failed" };

/**
 * Re-straighten a saved page from its retained source photograph.
 *
 * New objects are written under fresh keys before SQL changes. The page row
 * and every region annotation then move together in one transaction; only
 * after that succeeds are the obsolete derived objects removed.
 */
export async function updatePageCorners(
  userId: UserId,
  input: UpdatePageCornersInput,
): Promise<UpdatePageCornersResult> {
  const page = await findPage(userId, input.pageId);

  if (!page) return { status: "not-found" };
  if (!isPageProcessorConfigured()) return { status: "processor-unavailable" };

  const sourceStorageKey = page.originalStorageKey ?? page.storageKey;
  const sourceExists = await objectExists(sourceStorageKey).catch(() => false);

  if (!sourceExists) return { status: "source-unreadable" };

  const regionAnnotations = (await listAnnotationsForPage(userId, page.id)).filter(
    isRegionAnnotation,
  );

  // An automatically detected old crop retained no corners, so there is no
  // honest transform back to the source photograph. Editing remains safe when
  // no image annotations exist; otherwise the user must keep the old crop.
  if (page.originalStorageKey && !page.pageCorners && regionAnnotations.length > 0) {
    return { status: "annotations-cannot-be-remapped" };
  }

  const oldCorners = page.originalStorageKey ? page.pageCorners : null;
  const annotationUpdates = regionAnnotations.map((annotation) => ({
    annotationId: annotation.id,
    rect: remapRectBetweenPageCrops(
      {
        x: annotation.rectX,
        y: annotation.rectY,
        width: annotation.rectWidth,
        height: annotation.rectHeight,
      },
      oldCorners,
      input.corners,
    ),
  }));

  if (annotationUpdates.some((update) => update.rect === null)) {
    return { status: "annotations-cannot-be-remapped" };
  }

  const newStorageKey = revisedFlattenedKeyFor(sourceStorageKey);
  const processed = await rectifyPage(
    sourceStorageKey,
    newStorageKey,
    input.corners,
  );

  if (!processed?.rectified) {
    await removeObject(newStorageKey).catch(() => undefined);
    return { status: "processing-failed" };
  }

  const newThumbnailKey = thumbnailKeyFor(newStorageKey);
  let thumbnailStored = false;

  try {
    const processedBytes = await tryReadObject(newStorageKey);

    if (!processedBytes) {
      throw new Error("Processed image was not written.");
    }

    const thumbnail = await buildThumbnail(processedBytes);
    await uploadObject(newThumbnailKey, thumbnail, "image/jpeg");
    thumbnailStored = true;
  } catch {
    await removeObjects([newStorageKey, newThumbnailKey]).catch(() => undefined);
    return { status: "update-failed" };
  }

  let updatedPage: Page | null = null;

  try {
    updatedPage = await db.transaction(async (transaction) => {
      const updated = await updatePageGeometry(transaction, userId, page.id, {
        storageKey: newStorageKey,
        originalStorageKey: sourceStorageKey,
        thumbnailStorageKey: thumbnailStored ? newThumbnailKey : null,
        pageCorners: input.corners,
        imageWidth: processed.width,
        imageHeight: processed.height,
      });

      if (!updated) throw new Error("Page disappeared during corner update.");

      const annotationsUpdated = await updateRegionAnnotationRects(
        transaction,
        userId,
        page.id,
        annotationUpdates.map((update) => ({
          annotationId: update.annotationId,
          // Proven non-null by the check above.
          rect: update.rect!,
        })),
      );

      if (!annotationsUpdated) {
        throw new Error("An annotation disappeared during corner update.");
      }

      return updated;
    });
  } catch {
    await removeObjects([newStorageKey, newThumbnailKey]).catch(() => undefined);
    return { status: "update-failed" };
  }

  const obsoleteKeys = [
    page.storageKey !== sourceStorageKey ? page.storageKey : null,
    page.thumbnailStorageKey,
  ].filter((key): key is string => key !== null);
  let cleanupIncomplete = false;

  try {
    await removeObjects(obsoleteKeys);
  } catch {
    cleanupIncomplete = true;
  }

  return { status: "updated", page: updatedPage, cleanupIncomplete };
}

export async function getPageDeletionImpacts(
  userId: UserId,
  pageIds: PageId[],
): Promise<Map<PageId, number>> {
  return countAnnotationsForPages(userId, pageIds);
}

export type PageDashboardStats = AnnotationStatusCounts;

export async function getPageDashboardStats(
  userId: UserId,
  pageIds: PageId[],
): Promise<Map<PageId, PageDashboardStats>> {
  return countAnnotationStatusesForPages(userId, pageIds);
}

export type DeletePageResult =
  | { status: "not-found" }
  | {
      status: "deleted";
      bookId: Page["bookId"];
      cleanupIncomplete: boolean;
    };

/** Collect keys, delete the row and its annotations, then clean storage. */
export async function deletePageAndObjects(
  userId: UserId,
  pageId: PageId,
): Promise<DeletePageResult> {
  const page = await findPage(userId, pageId);

  if (!page) return { status: "not-found" };

  const keys = [
    page.storageKey,
    page.thumbnailStorageKey,
    page.originalStorageKey,
  ].filter((key): key is string => key !== null);

  if (!(await deletePage(userId, page.id))) return { status: "not-found" };

  try {
    await removeObjects(keys);
    return { status: "deleted", bookId: page.bookId, cleanupIncomplete: false };
  } catch {
    return { status: "deleted", bookId: page.bookId, cleanupIncomplete: true };
  }
}
