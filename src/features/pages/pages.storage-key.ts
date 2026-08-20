import type { BookId, UserId } from "@/db/ids";

/**
 * Where a page image lives inside the bucket.
 *
 * The layout is `<userId>/<bookId>/<random>.<ext>`, and the user id prefix is
 * load-bearing. The browser uploads directly and later tells the server "I put
 * it here" — so on that second request the path is user input. Because every
 * key begins with the owner's id, a claim about somebody else's object is
 * rejected by a string comparison rather than by a lookup that could be got
 * wrong.
 *
 * The filename is random rather than derived from the page number: page numbers
 * can be corrected, and an object whose name has to change when a row is edited
 * is an object that eventually disagrees with its row.
 */

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const ACCEPTED_CONTENT_TYPES = Object.keys(EXTENSION_BY_CONTENT_TYPE);

export function buildStorageKey(
  userId: UserId,
  bookId: BookId,
  contentType: string,
): string {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType];

  if (!extension) {
    // Unreachable via the routes, which validate the content type first. Kept
    // as an explicit throw so a future caller cannot silently produce a key
    // with an undefined extension.
    throw new Error(`Unsupported content type: ${contentType}`);
  }

  return `${userId}/${bookId}/${crypto.randomUUID()}.${extension}`;
}

/**
 * Whether a storage key claimed by a client really sits under this user's and
 * book's prefix. Called before any page row is written.
 */
export function isStorageKeyOwnedBy(
  storageKey: string,
  userId: UserId,
  bookId: BookId,
): boolean {
  return new RegExp(
    `^${userId}/${bookId}/[0-9a-f-]{36}\.(jpg|png|webp)$`,
  ).test(storageKey);
}
