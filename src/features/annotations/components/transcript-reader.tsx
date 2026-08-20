"use client";

import { Fragment, useRef, useState, useTransition } from "react";

import type { PageId } from "@/db/ids";

import { createTextAnnotationAction } from "../annotations.actions";
import { splitIntoParagraphs } from "../annotations.text";
import {
  isTextAnnotation,
  type Annotation,
  type TextAnnotation,
} from "../annotations.types";
import { DeleteAnnotationButton } from "./delete-annotation-button";

type TranscriptReaderProps = {
  pageId: PageId;
  transcript: string;
  annotations: Annotation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

/** Anything shorter is a stray click, not a selection anybody meant. */
const MIN_SELECTION = 2;

type Draft = { start: number; end: number; quote: string };

/**
 * Where a selection sits in the transcript, in characters.
 *
 * A browser selection is expressed in DOM nodes and offsets within them, which
 * is useless for storage: the DOM changes every time a highlight is added. This
 * converts it into an offset into the transcript string, which does not.
 *
 * The walk is necessary rather than fussy. A paragraph containing highlights
 * holds several text nodes, so `range.startOffset` is relative to whichever one
 * the selection began in — not to the paragraph. Accumulating the lengths of
 * every text node before it is what turns the two into one number.
 */
function offsetWithinParagraph(
  paragraph: HTMLElement,
  node: Node,
  offsetInNode: number,
): number | null {
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  let total = 0;

  while (walker.nextNode()) {
    const current = walker.currentNode;

    if (current === node) {
      return total + offsetInNode;
    }

    total += current.textContent?.length ?? 0;
  }

  return null;
}

function paragraphElementOf(node: Node | null): HTMLElement | null {
  const element =
    node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);

  return element?.closest<HTMLElement>("[data-paragraph-start]") ?? null;
}

/**
 * The transcript, with highlights, and a way to add one.
 *
 * Selecting text is the right gesture here in a way that dragging a rectangle
 * is not: the text reflows, so a rectangle over it would mean nothing the
 * moment the window changed width. A character range survives reflow because
 * reflowing does not change which characters were chosen.
 *
 * It is also free. The reader picked the words, so the passage is known without
 * asking a model — no vision call, no quota, no pending state, no retry.
 */
export function TranscriptReader({
  pageId,
  transcript,
  annotations,
  selectedId,
  onSelect,
}: TranscriptReaderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const paragraphs = splitIntoParagraphs(transcript);
  const textAnnotations = annotations.filter(isTextAnnotation);
  const selectedAnnotation = textAnnotations.find(
    (annotation) => annotation.id === selectedId,
  );

  function captureSelection() {
    const selection = window.getSelection();

    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const startParagraph = paragraphElementOf(range.startContainer);
    const endParagraph = paragraphElementOf(range.endContainer);

    if (!startParagraph || !endParagraph) {
      return;
    }

    const startBase = Number(startParagraph.dataset.paragraphStart);
    const endBase = Number(endParagraph.dataset.paragraphStart);

    const startOffset = offsetWithinParagraph(
      startParagraph,
      range.startContainer,
      range.startOffset,
    );
    const endOffset = offsetWithinParagraph(
      endParagraph,
      range.endContainer,
      range.endOffset,
    );

    if (startOffset === null || endOffset === null) {
      return;
    }

    const start = startBase + startOffset;
    const end = endBase + endOffset;

    if (end - start < MIN_SELECTION) {
      return;
    }

    // The quote comes from the transcript rather than from `selection.toString()`.
    // The two differ: the browser inserts line breaks between block elements, so
    // a selection spanning paragraphs would not match the stored text and the
    // server's staleness check would reject it.
    setDraft({ start, end, quote: transcript.slice(start, end) });
    setError(null);
  }

  function save() {
    if (!draft) return;

    startSaving(async () => {
      const result = await createTextAnnotationAction({
        pageId,
        textStart: draft.start,
        textEnd: draft.end,
        quotedText: draft.quote,
        userComment: comment,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      setDraft(null);
      setComment("");
      window.getSelection()?.removeAllRanges();
      onSelect(result.createdId);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        ref={containerRef}
        onMouseUp={captureSelection}
        onTouchEnd={captureSelection}
        className="mx-auto max-w-[62ch] font-serif text-[1.05rem] leading-[1.75]"
      >
        {paragraphs.map((paragraph) => (
          <p
            key={paragraph.start}
            data-paragraph-start={paragraph.start}
            className="mb-4 whitespace-pre-wrap"
          >
            {renderWithHighlights(
              paragraph.text,
              paragraph.start,
              textAnnotations,
              selectedId,
              onSelect,
            )}
          </p>
        ))}
      </div>

      {selectedAnnotation ? (
        <aside className="mx-auto flex w-full max-w-[62ch] items-start justify-between gap-5 border-t border-rule pt-4">
          <div>
            <p className="font-serif text-sm">“{selectedAnnotation.quotedText}”</p>
            {selectedAnnotation.userComment ? (
              <p className="mt-2 text-sm text-ink-muted">{selectedAnnotation.userComment}</p>
            ) : null}
          </div>
          <DeleteAnnotationButton id={selectedAnnotation.id} />
        </aside>
      ) : null}

      {draft ? (
        <div className="mx-auto flex w-full max-w-[62ch] flex-col gap-3 border border-accent/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">New note</h3>
            <p className="font-mono text-xs text-ink-muted">
              characters {draft.start}–{draft.end}
            </p>
          </div>

          <blockquote className="border-l-2 border-accent/50 pl-3 font-serif text-sm italic">
            {draft.quote.length > 300
              ? `${draft.quote.slice(0, 300)}…`
              : draft.quote}
          </blockquote>

          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What do you want to remember about this?"
            rows={3}
            className="border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
          />

          {error ? (
            <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={isSaving}
              className="bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
            >
              {isSaving ? "Saving…" : "Save note"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setComment("");
                setError(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="border border-rule px-4 py-2 text-sm"
            >
              Discard
            </button>
          </div>
        </div>
      ) : (
        <p className="mx-auto max-w-[62ch] text-xs text-ink-muted">
          Select any passage to attach a note to it.
        </p>
      )}
    </div>
  );
}

/**
 * A paragraph, with the parts covered by an annotation wrapped in `<mark>`.
 *
 * Ranges are clipped to this paragraph and to each other. Overlapping
 * annotations are not merged — the later one simply starts where the earlier
 * one ended, which keeps every character in exactly one element and the text
 * itself unchanged.
 */
function renderWithHighlights(
  text: string,
  paragraphStart: number,
  annotations: TextAnnotation[],
  selectedId: string | null,
  onSelect: (id: string | null) => void,
) {
  const paragraphEnd = paragraphStart + text.length;

  const covering = annotations
    .filter(
      (annotation) =>
        annotation.textStart < paragraphEnd &&
        annotation.textEnd > paragraphStart,
    )
    .sort((a, b) => a.textStart - b.textStart);

  if (covering.length === 0) {
    return text;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const annotation of covering) {
    const from = Math.max(0, annotation.textStart - paragraphStart);
    const to = Math.min(text.length, annotation.textEnd - paragraphStart);

    if (to <= cursor) {
      continue;
    }

    const start = Math.max(from, cursor);

    if (start > cursor) {
      parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor, start)}</Fragment>);
    }

    parts.push(
      <mark
        key={annotation.id}
        onClick={() => onSelect(annotation.id)}
        className={`cursor-pointer rounded-sm px-0.5 text-inherit ${
          selectedId === annotation.id
            ? "bg-accent/35 outline outline-1 outline-accent"
            : "bg-accent/18 hover:bg-accent/28"
        }`}
      >
        {text.slice(start, to)}
      </mark>,
    );

    cursor = to;
  }

  if (cursor < text.length) {
    parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor)}</Fragment>);
  }

  return parts;
}
