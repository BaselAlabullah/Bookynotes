"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PageId } from "@/db/ids";
import { TranscriptReader } from "@/features/annotations/components/transcript-reader";
import type { Annotation } from "@/features/annotations/annotations.types";

type PageTranscriptProps = {
  pageId: PageId;
  transcript: string | null;
  status: "pending" | "complete" | "failed" | null;
  error: string | null;
  /** The page number the reader filed this under. */
  pageNumber: number;
  /** The page number the model read off the page, if it found one. */
  printedPageNumber: string | null;
  annotations: Annotation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

/**
 * The page as text.
 *
 * Real text, not a picture of text — selectable, copyable, reflowing, and
 * readable by a screen reader. Rendering the transcript back into an image
 * would have looked like an e-book without being one, which is most of the
 * point.
 *
 * It is a second view of the page, never a replacement for it. A transcript is
 * what a model believed it read; names and unusual words are exactly where that
 * goes wrong, and a cleanly typeset page hides the mistake. The photograph is
 * always one click away, which is what makes trusting this reasonable.
 */
export function PageTranscript({
  pageId,
  transcript,
  status,
  error,
  pageNumber,
  printedPageNumber,
  annotations,
  selectedId,
  onSelect,
}: PageTranscriptProps) {
  const router = useRouter();
  const [isWorking, setIsWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function transcribe(force = false) {
    setIsWorking(true);
    setFailure(null);

    try {
      const response = await fetch(
        `/api/pages/${pageId}/transcribe${force ? "?force=true" : ""}`,
        { method: "POST" },
      );

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "The page could not be read.";
        setFailure(message);
      }
    } catch {
      setFailure("Could not reach the transcription service.");
    } finally {
      setIsWorking(false);
      // The transcript is server-rendered, so ask the server for it again
      // rather than holding a second copy here.
      router.refresh();
    }
  }

  /**
   * The cheapest integrity check available, and it costs one extra field.
   *
   * We already know which page this was filed as, and the model reports the
   * number printed on the page it read. When those disagree, something is
   * wrong: a mistyped page number, or a model that transcribed something other
   * than what is in front of it. Neither is worth refusing over, and both are
   * worth saying out loud — a clean transcript of the wrong page is exactly the
   * failure a typeset page would hide.
   */
  const pageNumberDisagrees =
    printedPageNumber !== null &&
    printedPageNumber.trim() !== "" &&
    printedPageNumber.trim() !== String(pageNumber);

  if (transcript) {
    // Splitting into paragraphs belongs to TranscriptReader, which needs each
    // one's offset in the transcript as well as its text. Doing it here too
    // would mean two implementations that must agree about where a paragraph
    // begins, and every annotation would be wrong by the difference if they
    // ever drifted.
    return (
      <div className="flex flex-col gap-5">
        {pageNumberDisagrees ? (
          <p
            role="alert"
            className="border-l-2 border-danger pl-3 text-sm text-danger"
          >
            This is filed as page {pageNumber}, but the page number printed on
            the photograph reads {printedPageNumber}. Check the original before
            trusting this transcript.
          </p>
        ) : null}

        <TranscriptReader
          pageId={pageId}
          transcript={transcript}
          annotations={annotations}
          selectedId={selectedId}
          onSelect={onSelect}
        />

        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-3">
          <p className="mr-auto text-xs text-ink-muted">
            Read by a model from your photograph. Check the original if a name
            or an unusual word looks wrong.
          </p>
          <button
            type="button"
            onClick={() => transcribe(true)}
            disabled={isWorking}
            className="text-xs uppercase tracking-[0.1em] text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink disabled:opacity-50"
          >
            {isWorking ? "Reading…" : "Read again"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[52ch] flex-col items-start gap-4 border border-dashed border-rule p-8">
      <p className="text-sm text-ink-muted">
        {status === "failed"
          ? "This page could not be read."
          : "This page has not been read yet."}
      </p>

      {(failure ?? error) ? (
        <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
          {failure ?? error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => transcribe(status === "failed")}
        disabled={isWorking}
        className="bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
      >
        {isWorking
          ? "Reading the page…"
          : status === "failed"
            ? "Try again"
            : "Read this page"}
      </button>

      <p className="text-xs text-ink-muted">
        The whole page goes to the vision model once. The result is kept, so
        this only happens a single time per page.
      </p>
    </div>
  );
}
