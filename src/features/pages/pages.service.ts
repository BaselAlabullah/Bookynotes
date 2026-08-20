import { isUniqueViolation } from "@/db/errors";
import type { UserId } from "@/db/ids";
import { findBook } from "@/features/books/books.repository";
import {
  createSignedUpload,
  objectExists,
  removeObject,
} from "@/integrations/storage/storage.client";
import type { SignedUpload } from "@/integrations/storage/storage.types";

import { insertPage } from "./pages.repository";
import type { CompleteUploadInput, UploadTargetInput } from "./pages.schema";
import { buildStorageKey, isStorageKeyOwnedBy } from "./pages.storage-key";
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

  try {
    const page = await insertPage(userId, {
      bookId: input.bookId,
      pageNumber: input.pageNumber,
      storageKey: input.storageKey,
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
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
    // The uploaded object now belongs to no row, so remove it rather than leave
    // litter behind.
    await removeObject(input.storageKey);

    return { status: "duplicate-page" };
  }
}
