"use client";

import { useState } from "react";

import type { PageId } from "@/db/ids";
import type { Annotation } from "@/features/annotations/annotations.types";
import { PageAnnotator } from "@/features/annotations/components/page-annotator";

import { PageTranscript } from "./page-transcript";

type PageSurfaceProps = {
  pageId: PageId;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  annotations: Annotation[];
  initialSelectedId?: string;
  previousHref?: string;
  nextHref?: string;
  transcript: string | null;
  transcriptStatus: "pending" | "complete" | "failed" | null;
  transcriptError: string | null;
  pageNumber: number;
  transcriptPageNumber: string | null;
};

type View = "original" | "reading";

/**
 * Chooses which of the two views of a page is on screen.
 *
 * They are genuinely two things, not one thing rendered twice:
 *
 * - **Original** — the photograph, with rectangles anchored to normalized
 *   coordinates. This is the page.
 * - **Reading** — the transcript, as real reflowing text. This is what a model
 *   read on it.
 *
 * Keeping both is the whole design. A clean typeset page is easier to read and
 * quietly wrong wherever the model misread a name; the photograph cannot be
 * wrong, because it is not an interpretation. Switching between them is one
 * click, so checking costs nothing.
 *
 * Annotations live on the photograph for now. Anchoring them to text ranges in
 * the transcript is the next step, and a bigger one — a rectangle over
 * reflowing text means nothing.
 */
export function PageSurface({
  annotations,
  transcript,
  transcriptStatus,
  transcriptError,
  pageNumber,
  transcriptPageNumber,
  ...annotatorProps
}: PageSurfaceProps) {
  const [view, setView] = useState<View>("original");
  // Selection is shared across both views, so clicking a note in one and
  // switching to the other keeps the same annotation current.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="How to view this page"
        className="screen-only flex w-fit border border-rule text-xs uppercase tracking-[0.1em]"
      >
        {(
          [
            ["original", "Original"],
            ["reading", "Reading"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={view === value}
            onClick={() => setView(value)}
            className={`px-4 py-2 ${
              view === value
                ? "bg-accent text-paper"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {label}
            {value === "reading" && transcript ? " ·" : ""}
          </button>
        ))}
      </div>

      {view === "original" ? (
        <PageAnnotator {...annotatorProps} annotations={annotations} />
      ) : (
        <PageTranscript
          pageId={annotatorProps.pageId}
          transcript={transcript}
          status={transcriptStatus}
          error={transcriptError}
          pageNumber={pageNumber}
          printedPageNumber={transcriptPageNumber}
          annotations={annotations}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}
    </div>
  );
}
