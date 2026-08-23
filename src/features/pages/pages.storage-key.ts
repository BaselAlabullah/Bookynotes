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
const OBJECT_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;

export function isStorageKeyOwnedBy(
  storageKey: string,
  userId: UserId,
  bookId: BookId,
): boolean {
  // The prefix is compared as a string and the filename against a fixed
  // pattern, rather than building one regex around the ids.
  //
  // Two reasons. Interpolating an id into a pattern makes any metacharacter it
  // might one day contain part of the matcher — these are UUIDs today, but a
  // string comparison cannot be wrong about that later. And the previous
  // pattern was written `\.` inside a template literal, where `\.` is not an
  // escape sequence and collapses to a bare `.`, so the separator before the
  // extension matched any character at all.
  const prefix = `${userId}/${bookId}/`;

  return (
    storageKey.startsWith(prefix) &&
    OBJECT_NAME.test(storageKey.slice(prefix.length))
  );
}

/**
 * Where the flattened version of a page lives.
 *
 * Derived from the original key so the two can never point at different pages,
 * and so the ownership prefix carries over unchanged: a flattened image sits
 * under exactly the same user and book as the photograph it came from.
 */
export function flattenedKeyFor(storageKey: string): string {
  return storageKey.replace(/\.[^./]+$/, "") + ".flat.jpg";
}

/**
 * A fresh derived key for editing an existing crop.
 *
 * The old flattened image stays readable until the database points at this
 * one, making the multi-system update recoverable if processing or SQL fails.
 */
export function revisedFlattenedKeyFor(storageKey: string): string {
  return `${storageKey.replace(/\.[^./]+$/, "")}.flat.${crypto.randomUUID()}.jpg`;
}
