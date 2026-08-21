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
  const [optimisticTranscript, setOptimisticTranscript] = useState<string | null>(
    null,
  );
  const [draftText, setDraftText] = useState(transcript ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeTranscript = optimisticTranscript ?? transcript;

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
    const hadTranscript = activeTranscript !== null;

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
      setOptimisticTranscript(text);
      setIsEditing(false);
      setNotice(
        hadTranscript
          ? "Saved your transcript edits."
          : "Saved the manual transcript. You can now select text notes without using Gemini.",
      );
      router.refresh();
    } catch {
      setFailure("Could not save the transcript.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  function startEditing() {
    setDraftText(activeTranscript ?? "");
    setFailure(null);
    setNotice(null);
    setIsEditing(true);
  }

  async function pasteFromClipboard() {
    setFailure(null);
    setNotice(null);

    try {
      const text = await navigator.clipboard.readText();

      if (text.trim().length === 0) {
        setFailure("The clipboard does not contain transcript text.");
        return;
      }

      setDraftText(text);
      setNotice("Pasted transcript text from the clipboard.");
    } catch {
      setFailure(
        "The browser did not allow clipboard access. Paste into the box manually.",
      );
    }
  }

  function cancelEditing() {
    setDraftText(activeTranscript ?? "");
    setFailure(null);
    setIsEditing(false);
  }

  const pageNumberDisagrees =
    printedPageNumber !== null &&
    printedPageNumber.trim() !== "" &&
    printedPageNumber.trim() !== String(pageNumber);
  const isWorking = isGeminiWorking || isSavingEdit;
  const transcriptWordCount = activeTranscript ? countWords(activeTranscript) : 0;

  if (activeTranscript && !isEditing) {
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
          transcript={activeTranscript}
          annotations={annotations}
          selectedId={selectedId}
          onSelect={onSelect}
        />

        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-3">
          <p className="mr-auto text-xs text-ink-muted">
            Saved transcript · {transcriptWordCount}{" "}
            {transcriptWordCount === 1 ? "word" : "words"}. Check the original
            if a name or unusual word looks wrong.
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
            {isGeminiWorking ? "Reading..." : "Replace with Gemini"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[58ch] flex-col items-start gap-4 border border-dashed border-rule p-8">
      {isEditing ? (
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-ink-muted">
            {activeTranscript ? "Transcript correction" : "Manual transcript"}
          </p>
          <h2 className="mt-1 font-serif text-2xl">
            {activeTranscript ? "Edit transcript" : "Paste transcript"}
          </h2>
          <p className="mt-2 max-w-[58ch] text-sm leading-6 text-ink-muted">
            {activeTranscript
              ? "Fix names or unusual words, then save. Existing text notes keep their quoted text even if offsets later drift."
              : "Use this when you already have text from an ebook, another OCR tool, or a quick manual transcription. It spends no Gemini quota."}
          </p>
        </div>
      ) : activeTranscript ? (
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-ink-muted">
            Transcript
          </p>
          <h2 className="mt-1 font-serif text-2xl">Ready to read</h2>
        </div>
      ) : (
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-ink-muted">
            Reading view
          </p>
          <h2 className="mt-1 font-serif text-2xl">
            Make this page searchable
          </h2>
          <p className="mt-2 max-w-[58ch] text-sm leading-6 text-ink-muted">
            {status === "failed"
              ? "Gemini could not read this page last time. You can retry it, or paste a transcript manually and keep moving."
              : "Read the photograph with Gemini, or paste text yourself. Manual text is instant, searchable, and free."}
          </p>
        </div>
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
            placeholder="Paste the page transcript here..."
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
              onClick={pasteFromClipboard}
              disabled={isWorking}
              className="border border-rule px-4 py-2 text-sm disabled:opacity-50"
            >
              Paste from clipboard
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
        <div className="grid w-full gap-3 sm:grid-cols-2">
          <div className="flex flex-col items-start gap-3 border border-rule bg-paper-raised p-4">
            <h3 className="font-serif text-lg">Use Gemini</h3>
            <p className="text-sm leading-6 text-ink-muted">
              Best when the photograph is all you have. Uses one vision request
              and can hit free-tier limits.
            </p>
          <button
            type="button"
            onClick={() => transcribeWithGemini(status === "failed")}
            disabled={isWorking}
            className="bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
          >
            {isGeminiWorking ? "Reading the page..." : "Read with Gemini"}
          </button>
          </div>

          <div className="flex flex-col items-start gap-3 border border-rule bg-paper-raised p-4">
            <h3 className="font-serif text-lg">Paste manually</h3>
            <p className="text-sm leading-6 text-ink-muted">
              Best when you already have the text. Costs no Gemini quota and
              unlocks exact text selection notes.
            </p>
            <button
              type="button"
              onClick={startEditing}
              disabled={isWorking}
              className="border border-rule px-4 py-2 text-sm hover:border-accent disabled:opacity-50"
            >
              Paste transcript
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
