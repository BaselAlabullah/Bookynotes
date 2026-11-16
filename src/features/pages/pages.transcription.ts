import type { PageId, UserId } from "@/db/ids";
import { createSignedRead } from "@/integrations/storage/storage.client";
import { transcribePage } from "@/integrations/vision/vision.client";
import {
  VisionPermanentError,
  VisionRateLimitError,
} from "@/integrations/vision/vision.types";

import {
  findPage,
  savePageTranscript,
  recordTranscriptionFailure,
} from "./pages.repository";
import type { SavePageTranscriptInput } from "./pages.schema";
import type { Page } from "./pages.types";

/**
 * Reading a whole page, rather than one marked rectangle.
 *
 * Same shape as annotation enrichment and for the same reasons: it runs in its
 * own request so a write never waits on a model, the result is cached on the
 * row so the same page is never read twice, and failures are ordinary outcomes
 * with a retry rather than exceptions.
 *
 * What it is *not* is a replacement for the photograph. The transcript is what
 * a model believed it read; the picture is the page. Names and unusual words
 * are exactly where transcription goes wrong, and a clean-looking page hides
 * that — which is why the reading view can always be switched back.
 */

export type TranscriptionOutcome =
  | { status: "complete"; page: Page }
  /** Already transcribed. The model was not called. */
  | { status: "cached"; page: Page }
  | { status: "not-found" }
  /** Worth trying again: rate limits and blips land here. */
  | { status: "retryable"; message: string }
  /** A failure that will not succeed by repeating it. */
  | { status: "failed"; message: string };

export async function transcribePageById(
  userId: UserId,
  pageId: PageId,
  options: { force?: boolean } = {},
): Promise<TranscriptionOutcome> {
  const page = await findPage(userId, pageId);

  if (!page) {
    return { status: "not-found" };
  }

  // Reuse the saved transcript unless the reader requests a replacement.
  if (page.transcriptStatus === "complete" && !options.force) {
    return { status: "cached", page };
  }

  try {
    const signed = await createSignedRead(page.storageKey);
    const response = await fetch(signed.url);

    if (!response.ok) {
      return await recordFailure(
        userId,
        pageId,
        `The page image could not be read (${response.status}).`,
        false,
      );
    }

    // The whole page goes to the model, not a crop: the point is everything on
    // it. No marker is drawn either — there is no region to point at.
    const result = await transcribePage({
      image: Buffer.from(await response.arrayBuffer()),
      mimeType: "image/jpeg",
    });

    const text = result.text.trim();

    if (text.length === 0) {
      // A blank result on a page that plainly has words on it means the model
      // failed to read it, not that the page is empty. Storing "" would look
      // like a successful transcription of nothing.
      return await recordFailure(
        userId,
        pageId,
        "The model returned an empty transcript.",
        false,
      );
    }

    const updated = await savePageTranscript(
      userId,
      pageId,
      text,
      result.printedPageNumber.trim() || null,
    );

    return updated
      ? { status: "complete", page: updated }
      : { status: "not-found" };
  } catch (error) {
    if (error instanceof VisionRateLimitError) {
      // A quota wall is not this page's fault, so it does not become a terminal
      // failure — the same rule enrichment follows.
      return await recordFailure(
        userId,
        pageId,
        "The model is rate limited right now. Try again shortly.",
        false,
      );
    }

    return await recordFailure(
      userId,
      pageId,
      error instanceof Error ? error.message : "Transcription failed.",
      error instanceof VisionPermanentError,
    );
  }
}

export async function savePageTranscriptById(
  userId: UserId,
  pageId: PageId,
  input: SavePageTranscriptInput,
): Promise<TranscriptionOutcome> {
  const text = input.text.trim();

  if (text.length === 0) {
    return { status: "failed", message: "Transcript text cannot be empty." };
  }

  const updated = await savePageTranscript(
    userId,
    pageId,
    text,
    input.printedPageNumber?.trim() || null,
  );

  return updated
    ? { status: "complete", page: updated }
    : { status: "not-found" };
}

async function recordFailure(
  userId: UserId,
  pageId: PageId,
  message: string,
  isTerminal: boolean,
): Promise<TranscriptionOutcome> {
  await recordTranscriptionFailure(userId, pageId, message, isTerminal);

  return isTerminal
    ? { status: "failed", message }
    : { status: "retryable", message };
}
