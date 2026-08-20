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

export type TranscriptionResult = {
  /** The whole page, as prose. Paragraphs separated by blank lines. */
  text: string;
  /**
   * The page number printed on the page, as the model read it.
   *
   * Asked for as an integrity check, not for display. We already know which
   * page the reader filed this as, so a disagreement is a signal that something
   * is wrong — a mistyped page number, or a model that read the wrong thing.
   * Empty when no number is printed, which is normal for a chapter opening.
   */
  printedPageNumber: string;
};

export type VisionProvider = {
  /** Name for logs and for telling the user which model produced a result. */
  readonly name: string;
  /** One marked region: the passage inside it, and what surrounds it. */
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
  /**
   * A whole page, as readable text.
   *
   * A separate method rather than `extract` with a different prompt, because
   * the two differ in what they return, what they cost and how they fail. One
   * reads a rectangle somebody drew; the other reads everything. Overloading a
   * single method would have meant a result type that is half-empty either way.
   */
  transcribe(request: ExtractionRequest): Promise<TranscriptionResult>;
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

/**
 * What we ask for when transcribing a whole page.
 *
 * Two instructions matter more than the rest.
 *
 * **Rejoin hyphenated words.** Print breaks words across lines; a transcript
 * that keeps "bro-\nken" is unsearchable and unreadable. This is the single
 * most common way a naive page transcript is useless.
 *
 * **Do not tidy.** The temptation for a language model is to smooth the prose,
 * modernise punctuation, or finish a sentence the page cut off. This app exists
 * to record what a book says, so an improved sentence is a wrong one.
 */
export const TRANSCRIPTION_PROMPT = `You are transcribing a photograph of a page from a physical book.

Return JSON with exactly two fields:

- "printed_page_number": the page number printed on the page, as a string.
  Use "" if no number is printed.
- "text": everything printed on the page, transcribed verbatim.

Rules:

- Preserve the author's wording, spelling and punctuation exactly. Do not
  modernise, correct, summarise or complete anything.
- Rejoin words broken across a line by a hyphen, so "bro-" at the end of one
  line and "ken" at the start of the next becomes "broken".
- Separate paragraphs with a blank line. Do not keep the printed line breaks
  inside a paragraph; the text will be reflowed.
- Include the running head and page number if they are printed, each on their
  own line.
- If part of the page is unreadable, write [unclear] in its place rather than
  guessing.
- Transcribe only the page in the photograph. Ignore a facing page, a desk, or
  anything held in shot.
- Transcribe only what is visible. You may recognise the book; do not use
  anything you remember about it. If the words in front of you differ from what
  you expect, the words in front of you are correct.

Respond with JSON only.`
