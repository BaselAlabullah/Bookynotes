"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PageId } from "@/db/ids";
import type { Annotation } from "@/features/annotations/annotations.types";
import { TranscriptReader } from "@/features/annotations/components/transcript-reader";

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
 * Real text, not a picture of text: selectable, copyable, reflowing, and
 * readable by a screen reader. The photograph stays one click away because a
 * transcript is an OCR/model interpretation, while the photograph is the page.
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
  const [isGeminiWorking, setIsGeminiWorking] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(transcript ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function transcribeWithGemini(force = false) {
    setIsGeminiWorking(true);
    setFailure(null);
    setNotice(null);

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
        return;
      }

      setIsEditing(false);
      setNotice(
        force
          ? "Gemini re-read the page and replaced the transcript."
          : "Gemini read the page and saved the transcript.",
      );
    } catch {
      setFailure("Could not reach the transcription service.");
    } finally {
      setIsGeminiWorking(false);
      router.refresh();
    }
  }

  async function saveEditedTranscript() {
    const text = draftText.trim();

    if (text.length === 0) {
      setFailure("Transcript text cannot be empty.");
      return;
    }

    setIsSavingEdit(true);
    setFailure(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/pages/${pageId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "The transcript could not be saved.";
        setFailure(message);
        return;
      }

      setDraftText(text);
      setIsEditing(false);
      setNotice("Saved your transcript edits.");
      router.refresh();
    } catch {
      setFailure("Could not save the transcript.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  function startEditing() {
    setDraftText(transcript ?? "");
    setFailure(null);
    setNotice(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraftText(transcript ?? "");
    setFailure(null);
    setIsEditing(false);
  }

  const pageNumberDisagrees =
    printedPageNumber !== null &&
    printedPageNumber.trim() !== "" &&
    printedPageNumber.trim() !== String(pageNumber);
  const isWorking = isGeminiWorking || isSavingEdit;

  if (transcript && !isEditing) {
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

        {notice ? (
          <p className="border-l-2 border-accent pl-3 text-sm text-ink-muted">
            {notice}
          </p>
        ) : null}

        {(failure ?? error) ? (
          <p
            role="alert"
            className="border-l-2 border-danger pl-3 text-sm text-danger"
          >
            {failure ?? error}
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
            Read by Gemini from your photograph. Check the original if a name or
            an unusual word looks wrong.
          </p>
          <button
            type="button"
            onClick={startEditing}
            disabled={isWorking}
            className="text-xs uppercase tracking-[0.1em] text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink disabled:opacity-50"
          >
            Edit transcript
          </button>
          <button
            type="button"
            onClick={() => transcribeWithGemini(true)}
            disabled={isWorking}
            className="text-xs uppercase tracking-[0.1em] text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink disabled:opacity-50"
          >
            {isGeminiWorking ? "Reading..." : "Read again with Gemini"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[58ch] flex-col items-start gap-4 border border-dashed border-rule p-8">
      {transcript ? (
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-ink-muted">
            Transcript correction
          </p>
          <h2 className="mt-1 font-serif text-2xl">Edit transcript</h2>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          {status === "failed"
            ? "This page could not be read."
            : "This page has not been read yet."}
        </p>
      )}

      {(failure ?? error) ? (
        <p
          role="alert"
          className="border-l-2 border-danger pl-3 text-sm text-danger"
        >
          {failure ?? error}
        </p>
      ) : null}

      {notice ? (
        <p className="border-l-2 border-accent pl-3 text-sm text-ink-muted">
          {notice}
        </p>
      ) : null}

      {isEditing ? (
        <>
          <textarea
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            rows={18}
            className="w-full resize-y border border-rule bg-paper-raised px-3 py-2 font-serif text-sm leading-6 outline-none focus:border-accent"
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveEditedTranscript}
              disabled={isWorking || draftText.trim().length === 0}
              className="bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
            >
              {isSavingEdit ? "Saving..." : "Save transcript"}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              disabled={isWorking}
              className="text-sm text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => transcribeWithGemini(status === "failed")}
            disabled={isWorking}
            className="bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
          >
            {isGeminiWorking ? "Reading the page..." : "Read with Gemini"}
          </button>

          <p className="text-xs text-ink-muted">
            The whole page goes to Gemini once. The result is kept, and you can
            edit it after reading if a name or unusual word is off.
          </p>
        </>
      )}
    </div>
  );
}
