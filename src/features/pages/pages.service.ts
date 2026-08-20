import { isUniqueViolation } from "@/db/errors";
import type { UserId } from "@/db/ids";
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
  uploadObject,
} from "@/integrations/storage/storage.client";
import type { SignedUpload } from "@/integrations/storage/storage.types";

import { insertPage } from "./pages.repository";
import type { CompleteUploadInput, UploadTargetInput } from "./pages.schema";
import { buildStorageKey, isStorageKeyOwnedBy } from "./pages.storage-key";
import { flattenedKeyFor } from "./pages.storage-key";
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
    const result = await rectifyPage(uploaded, "image/jpeg", corners);

    // Null means unreachable or refused. `rectified: false` means it looked and
    // found no page, so the picture came back cleaned but not warped — not
    // worth a second object and a second key.
    if (!result || !result.rectified) {
      return untouched;
    }

    const flattenedKey = flattenedKeyFor(storageKey);
    await uploadObject(flattenedKey, result.image, "image/jpeg");

    return {
      bytes: result.image,
      storageKey: flattenedKey,
      originalStorageKey: storageKey,
      width: result.width,
      height: result.height,
    };
  } catch {
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
