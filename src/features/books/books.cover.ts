import sharp from "sharp";

import type { BookId, UserId } from "@/db/ids";
import { signedReadUrls } from "@/integrations/storage/signed-read-cache";
import { uploadObject } from "@/integrations/storage/storage.client";

import type { Book } from "./books.types";

/**
 * Keeping our own copy of a book cover.
 *
 * Open Library serves covers from its own CDN, and measured from here that CDN
 * answers in 1.5 to 2.8 seconds. Long enough that a library page renders as a
 * column of alt text and then rearranges itself when the pictures turn up —
 * which is what it looked like, and why this exists.
 *
 * So a cover is fetched once, when the book is added, and stored in the same
 * bucket as everything else. After that it is served the way page thumbnails
 * are: signed in one batched, cached request, from a CDN we already talk to on
 * that page anyway.
 */

/** Twice the rendered width, so it stays sharp on a dense display. */
const COVER_WIDTH = 200;

/** Open Library is not fast, and this runs inside the add-book request. */
const FETCH_TIMEOUT_MS = 10_000;

/** A cover that arrives far too large is a sign something else is at that URL. */
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

export function coverStorageKeyFor(userId: UserId, bookId: BookId): string {
  // Under the owner's prefix like every other object, so the same ownership
  // rule holds without a second mechanism.
  return `${userId}/covers/${bookId}.jpg`;
}

/**
 * Fetch, shrink and store a cover. Returns the storage key, or null.
 *
 * Null is an ordinary outcome, not an error: Open Library may be down, the URL
 * may 404, the bytes may not be an image. The book is already saved by the time
 * this runs and `cover_url` still points at the original, so the worst case is
 * the slow path we had before.
 */
export async function storeBookCover(
  userId: UserId,
  bookId: BookId,
  coverUrl: string,
): Promise<string | null> {
  try {
    const response = await fetch(coverUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Marginalia/0.1 (github.com/marginalia)" },
    });

    if (!response.ok) {
      return null;
    }

    const bytes = Buffer.from(await response.arrayBuffer());

    if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES) {
      return null;
    }

    // Re-encoding is not only about size. It is also what turns whatever
    // arrived at that URL into a known JPEG, or throws — sharp will not decode
    // an HTML error page that came back with a 200.
    const cover = await sharp(bytes)
      .resize({ width: COVER_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();

    const key = coverStorageKeyFor(userId, bookId);
    await uploadObject(key, cover, "image/jpeg");

    return key;
  } catch {
    return null;
  }
}

/**
 * Signed URLs for a list of books' covers, in one request.
 *
 * Books whose cover was never stored are absent from the map; the caller falls
 * back to `coverUrl`, which is slow but correct.
 */
export async function signBookCovers(
  books: Book[],
): Promise<Map<BookId, string>> {
  const keyByBook = new Map<BookId, string>();

  for (const book of books) {
    if (book.coverStorageKey) {
      keyByBook.set(book.id, book.coverStorageKey);
    }
  }

  if (keyByBook.size === 0) {
    return new Map();
  }

  const signed = await signedReadUrls([...keyByBook.values()]);
  const urls = new Map<BookId, string>();

  for (const [bookId, key] of keyByBook) {
    const url = signed.get(key);
    if (url) urls.set(bookId, url);
  }

  return urls;
}
