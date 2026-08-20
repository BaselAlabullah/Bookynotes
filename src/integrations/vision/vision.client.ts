import { publicEnv } from "@/config/env.public";
import { serverEnv } from "@/config/env.server";

import { createGeminiProvider } from "./gemini.provider";
import { createOpenRouterProvider } from "./openrouter.provider";
import {
  VisionPermanentError,
  VisionRateLimitError,
  VisionTransientError,
  type ExtractionRequest,
  type ExtractionResult,
  type VisionProvider,
} from "./vision.types";

/**
 * Picks the provider and applies the retry policy. The only file that knows
 * both implementations exist.
 */

function selectProvider(): VisionProvider {
  if (serverEnv.VISION_PROVIDER === "openrouter") {
    // Non-null: env.server.ts refuses to start unless the selected provider's
    // key is present, so reaching here without one is impossible.
    return createOpenRouterProvider(
      serverEnv.OPENROUTER_API_KEY ?? "",
      serverEnv.OPENROUTER_VISION_MODEL,
      publicEnv.NEXT_PUBLIC_APP_URL,
    );
  }

  return createGeminiProvider(
    serverEnv.GEMINI_API_KEY ?? "",
    serverEnv.GEMINI_VISION_MODEL,
  );
}

const provider = selectProvider();

export const visionProviderName = provider.name;

/**
 * How many times to call the model inside a single request.
 *
 * Deliberately small. This runs in a serverless function with a hard wall-clock
 * limit, so a long backoff would not survive to complete — it would be killed
 * mid-wait and the user would see nothing. Persistent failures are handled by
 * *ending the request* and leaving the row retryable, not by waiting here.
 */
const MAX_ATTEMPTS = 3;

/** Base delay. Doubles each attempt: roughly 400ms, then 800ms. */
const BASE_DELAY_MS = 400;

/**
 * The longest we will sit inside a request waiting on a rate limit. Beyond
 * this, giving the user a "try again" button beats holding a function open.
 */
const MAX_RATE_LIMIT_WAIT_MS = 3_000;

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call the vision model, retrying only what is worth retrying.
 *
 * Three outcomes leave this function:
 *
 * - a result;
 * - `VisionPermanentError`, thrown immediately and never retried — a bad key or
 *   a rejected image fails identically every time, and retrying it spends the
 *   budget a genuinely transient failure needs;
 * - `VisionRateLimitError` or `VisionTransientError` after the attempts are
 *   spent, for the caller to record as a retryable failure.
 */
export async function extractPassage(
  request: ExtractionRequest,
): Promise<ExtractionResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await provider.extract(request);
    } catch (error) {
      if (error instanceof VisionPermanentError) {
        throw error;
      }

      lastError = error;

      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;

      if (isLastAttempt) {
        break;
      }

      if (error instanceof VisionRateLimitError) {
        const asked = (error.retryAfterSeconds ?? 0) * 1000;

        // If the provider asks for longer than we are willing to hold the
        // request open, stop now and let the user retry later. Free tiers
        // routinely answer "come back in 60 seconds".
        if (asked > MAX_RATE_LIMIT_WAIT_MS) {
          throw error;
        }

        await sleep(Math.max(asked, BASE_DELAY_MS));
        continue;
      }

      if (error instanceof VisionTransientError) {
        // Exponential, with jitter. Jitter matters because several annotations
        // enriched at once would otherwise retry in lockstep and hit the same
        // quota wall together.
        const delay = BASE_DELAY_MS * 2 ** attempt;
        await sleep(delay + Math.random() * BASE_DELAY_MS);
        continue;
      }

      // An error the provider did not classify. Treat it as permanent: an
      // unknown failure retried blindly is how a quota disappears.
      throw error;
    }
  }

  throw lastError;
}
