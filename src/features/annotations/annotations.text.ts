/**
 * Splitting a transcript into paragraphs *without losing where they were*.
 *
 * This is the whole trick behind text annotations, and it is easy to get
 * subtly wrong. The obvious implementation —
 *
 *     transcript.split(/\n\s*\n/).map((p) => p.trim())
 *
 * — throws away the one thing that matters: the index each paragraph started
 * at in the original string. Once that is gone, a selection made in the browser
 * can only be described relative to a paragraph, and an offset relative to a
 * paragraph is meaningless to the database.
 *
 * So paragraphs are found by scanning, and each carries its absolute start. A
 * selection then converts to an absolute range with one addition, and the same
 * arithmetic runs unchanged on the server when the annotation is validated.
 *
 * Shared by the browser and the server deliberately: if the two disagreed about
 * where a paragraph begins, every annotation would be off by the difference.
 */

export type TranscriptParagraph = {
  /** The paragraph's text, with surrounding whitespace removed. */
  text: string;
  /** Index in the full transcript of this paragraph's first character. */
  start: number;
};

/** Blank line, possibly with spaces on it, separates paragraphs. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/g;

export function splitIntoParagraphs(
  transcript: string,
): TranscriptParagraph[] {
  const paragraphs: TranscriptParagraph[] = [];

  // Scanned with exec rather than String.split, because split discards the
  // separators and the separator length is not fixed: a blank line may be two
  // characters or several, depending on whether it carries spaces. Assuming a
  // fixed length silently shifts every paragraph after the first — and a
  // shifted offset does not fail, it quietly points at the wrong words. A unit
  // test caught exactly that.
  const separator = new RegExp(PARAGRAPH_BREAK);
  const chunks: { chunk: string; start: number }[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(transcript)) !== null) {
    chunks.push({ chunk: transcript.slice(cursor, match.index), start: cursor });
    cursor = match.index + match[0].length;
  }

  chunks.push({ chunk: transcript.slice(cursor), start: cursor });

  for (const { chunk, start } of chunks) {
    // Where the visible text begins, once leading whitespace is skipped. The
    // rendered <p> contains exactly this substring, so a browser offset into it
    // becomes an offset into the transcript by adding `start`.
    const leading = chunk.length - chunk.trimStart().length;
    const text = chunk.trim();

    if (text.length > 0) {
      paragraphs.push({ text, start: start + leading });
    }
  }

  return paragraphs;
}

/**
 * How much text to keep either side of a selection, as its context.
 *
 * Enough to place a quotation in its paragraph, not so much that the context
 * field becomes a second copy of the page.
 */
const CONTEXT_CHARS = 240;

/**
 * The text surrounding a selection.
 *
 * Computed by slicing a string we already have — no model call, no quota, no
 * failure mode. That is the quiet advantage of a text anchor over a region one:
 * the reader chose the words, so the passage and its surroundings are already
 * known, and `extracted_passage` can be filled in at insert time rather than by
 * a vision request that might be rate limited until tomorrow.
 */
export function contextAround(
  transcript: string,
  start: number,
  end: number,
): string {
  const before = transcript.slice(Math.max(0, start - CONTEXT_CHARS), start);
  const after = transcript.slice(end, end + CONTEXT_CHARS);

  return `${before.trimStart()}…${after.trimEnd()}`.trim();
}

/**
 * Whether the stored range still points at the words it was made from.
 *
 * Offsets are brittle by nature: transcribe a page again, have the model read
 * one word differently, and every offset after it shifts. The quote is what
 * makes that detectable — it was captured at the moment of selection, so a
 * mismatch means the transcript moved underneath the annotation.
 */
export function rangeStillMatches(
  transcript: string,
  start: number,
  end: number,
  quotedText: string,
): boolean {
  return transcript.slice(start, end) === quotedText;
}
