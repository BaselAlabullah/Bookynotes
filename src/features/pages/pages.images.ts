import type { PageId } from "@/db/ids";
import { signedReadUrls } from "@/integrations/storage/signed-read-cache";

import type { Page } from "./pages.types";

/**
 * Signed URLs for a set of pages, in one request.
 *
 * Two things are being fixed here, both measured rather than assumed:
 *
 * - **One round trip, not N.** Signing each page separately cost about 290ms
 *   each; a twelve-page filmstrip paid twelve of them before any HTML was sent.
 * - **Thumbnails for anything small.** A grid tile and a filmstrip frame get
 *   the derived thumbnail; only the page actually being read gets the full
 *   photograph. Before this, a book grid downloaded 24 MB of phone photos to
 *   display them a couple of hundred pixels wide.
 *
 * Pages uploaded before thumbnails existed have none, so they fall back to the
 * original. That is slow but correct, and `npm run backfill:thumbnails` fixes
 * it permanently.
 *
 * The signing itself is cached for ten minutes, which is the third fix and the
 * least obvious. A signed URL that is regenerated on every render is a URL the
 * browser has never seen before, so every navigation re-downloads every image
 * it already has. Reusing the URL is what makes the browser cache work at all.
 */
export type SignedPageImages = {
  /** Small image per page: the thumbnail, or the original if there is none. */
  thumbnails: Map<PageId, string>;
  /** Full-size image, only for the pages explicitly asked for. */
  full: Map<PageId, string>;
};

export async function signPageImages(
  pages: Page[],
  fullSizeFor: PageId[] = [],
): Promise<SignedPageImages> {
  const wantsFull = new Set(fullSizeFor);

  // Storage keys are unique per page, so this maps cleanly back afterwards.
  const smallKeyByPage = new Map<PageId, string>();
  const fullKeyByPage = new Map<PageId, string>();

  for (const page of pages) {
    smallKeyByPage.set(page.id, page.thumbnailStorageKey ?? page.storageKey);

    if (wantsFull.has(page.id)) {
      fullKeyByPage.set(page.id, page.storageKey);
    }
  }

  const signed = await signedReadUrls([
    ...smallKeyByPage.values(),
    ...fullKeyByPage.values(),
  ]);

  const thumbnails = new Map<PageId, string>();
  const full = new Map<PageId, string>();

  for (const [pageId, key] of smallKeyByPage) {
    const url = signed.get(key);
    // A key that failed to sign is absent, so one unreadable object costs one
    // thumbnail rather than the whole page.
    if (url) thumbnails.set(pageId, url);
  }

  for (const [pageId, key] of fullKeyByPage) {
    const url = signed.get(key);
    if (url) full.set(pageId, url);
  }

  return { thumbnails, full };
}

