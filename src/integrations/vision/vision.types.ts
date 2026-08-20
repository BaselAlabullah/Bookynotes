/**
 * The contract every vision provider implements.
 *
 * Nothing outside this directory knows which model answered, or that Gemini and
 * OpenRouter exist. Swapping providers is one environment variable, because the
 * rest of the app only ever sees these types.
 */

export type ExtractionRequest = {
  /** The image to look at: a cropped, cleaned region of a page photograph. */
  image: Buffer;
  /** Its mime type, so a provider can label the upload correctly. */
  mimeType: string;
};

export type ExtractionResult = {
  /** The words inside the marked rectangle, transcribed verbatim. */
  passage: string;
  /** What surrounds it, in a sentence or two. */
  context: string;
};

/**
 * Failures are split by what the caller should *do*, not by what went wrong.
 * That is the only distinction the retry policy needs, and keeping it in the
 * type means a provider cannot report a fatal error in a way that causes an
 * infinite retry loop.
 */

/** Out of quota. Retrying later may work; retrying now will not. */
export class VisionRateLimitError extends Error {
  /** Seconds the provider asked us to wait, when it says. */
  readonly retryAfterSeconds: number | null;

  constructor(message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "VisionRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** A blip: a timeout, a 5xx, a dropped connection. Worth retrying immediately. */
export class VisionTransientError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "VisionTransientError";
  }
}

/**
 * Retrying will not help: a bad key, a rejected image, a model that no longer
 * exists. These go straight to 'failed' without burning the retry budget.
 */
export class VisionPermanentError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "VisionPermanentError";
  }
}

export type VisionProvider = {
  /** Name for logs and for telling the user which model produced a result. */
  readonly name: string;
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
};

/**
 * What we ask the model for, in both providers.
 *
 * The image it receives is a padded crop with the user's own selection drawn
 * onto it, so "the highlighted region" is unambiguous rather than something the
 * model has to infer from coordinates in a prompt.
 */
export const EXTRACTION_PROMPT = `You are reading a photograph of a page from a physical book.

A rectangle has been drawn on the image marking a passage the reader selected.

Return JSON with exactly two fields:

- "passage": the text inside the drawn rectangle, transcribed verbatim. Preserve
  the author's wording, spelling and punctuation. Do not summarise, correct or
  complete it. If the rectangle cuts a word in half, include the whole word. If
  no text is legible inside the rectangle, use an empty string.
- "context": one or two sentences describing what surrounds the passage and what
  is being discussed, using only what is visible on this page. Do not speculate
  about the wider book.

Respond with JSON only.`;
