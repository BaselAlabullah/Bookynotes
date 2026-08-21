import { unstable_cache } from "next/cache";

import { createSignedReads } from "./storage.client";

/**
 * Batched signing, memoised.
 *
 * Two problems solved in one place, both measured:
 *
 * - Signing one object per request cost about 290ms each; a twelve-frame
 *   filmstrip paid twelve of them before any HTML was sent.
 * - A signed URL regenerated on every render is a URL the browser has never
 *   seen, so every navigation re-downloaded images it already had. **A URL that
 *   changes each render is a cache that never hits.**
 *
 * Five minutes, against the fifteen minute lifetime of the URLs themselves, so
 * ordinary traffic starts revalidation while roughly ten minutes remain. The
 * recovery path still handles a stale-while-revalidate response that has lived
 * longer than that window.
 *
 * What is cached is an answer, never a permission. Every caller has already
 * proved ownership of the rows before reaching here, and storage keys begin
 * with the owner's user id, so two users cannot collide on a cache entry.
 *
 * A `Map` does not survive the cache boundary, so the value crossing it is an
 * array of pairs.
 */
export async function signedReadUrls(
  storageKeys: string[],
): Promise<Map<string, string>> {
  if (storageKeys.length === 0) {
    return new Map();
  }

  // Sorted so that the same set of keys produces the same cache entry
  // regardless of the order the caller happened to collect them in.
  const sorted = [...new Set(storageKeys)].sort();

  const entries = await unstable_cache(
    async () => [...(await createSignedReads(sorted))],
    ["signed-reads", ...sorted],
    { revalidate: 300 },
  )();

  return new Map(entries);
}
