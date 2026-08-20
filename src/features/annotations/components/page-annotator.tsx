"use client";

import { useState, useTransition } from "react";

import type { PageId } from "@/db/ids";

import { createAnnotationAction } from "../annotations.actions";
import type { Annotation, NormalizedRect } from "../annotations.types";
import { AnnotationCanvas } from "./annotation-canvas";

type PageAnnotatorProps = {
  pageId: PageId;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  annotations: Annotation[];
};

/**
 * Discrete steps rather than free zoom: fewer states to reason about, and every
 * one of them is reachable with a single click.
 *
 * 1 is not "actual size", it is "the whole page visible" — the canvas fits the
 * page to the viewport at 1, so there is nothing useful below it and no need
 * for fractional steps.
 */
const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Owns the state around the canvas: what is selected, what is being drawn, and
 * the zoom level. The canvas itself is presentational, so all of the awkward
 * "what is happening right now" lives in one place.
 */
export function PageAnnotator({
  pageId,
  imageUrl,
  imageWidth,
  imageHeight,
  annotations,
}: PageAnnotatorProps) {
  const [zoomIndex, setZoomIndex] = useState(0);
  const [draft, setDraft] = useState<NormalizedRect | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;

  function save() {
    if (!draft) {
      return;
    }

    setError(null);

    // The Server Function is called directly rather than through a form action,
    // so the result comes back as a value and the draft is cleared only once
    // the write has actually succeeded. Setting state inside a transition
    // callback is an event, not an effect — nothing is being synchronised here.
    startSaving(async () => {
      const result = await createAnnotationAction({
        pageId,
        rect: draft,
        userComment: comment,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      setDraft(null);
      setComment("");
      setSelectedId(result.createdId);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
            disabled={zoomIndex === 0}
            className="rounded border border-ink-muted/30 px-2 py-1 disabled:opacity-40"
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="w-14 text-center tabular-nums text-ink-muted">
            {zoom === 1 ? "Fit" : `${zoom}×`}
          </span>
          <button
            type="button"
            onClick={() =>
              setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))
            }
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            className="rounded border border-ink-muted/30 px-2 py-1 disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>

        <p className="text-sm text-ink-muted">
          Drag across a passage to mark it.
        </p>
      </div>

      <AnnotationCanvas
        imageUrl={imageUrl}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        zoom={zoom}
        annotations={annotations}
        draft={draft}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onDraftChange={setDraft}
      />

      {draft ? (
        <div className="flex flex-col gap-3 rounded-lg border border-accent/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">New annotation</h2>
            {/* Shown because this is a portfolio project about coordinates:
                these are the exact numbers being stored, and they are fractions
                rather than pixels. */}
            <p className="font-mono text-xs text-ink-muted">
              x {formatPercent(draft.x)} · y {formatPercent(draft.y)} · w{" "}
              {formatPercent(draft.width)} · h {formatPercent(draft.height)}
            </p>
          </div>

          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What do you want to remember about this passage?"
            rows={3}
            className="rounded-md border border-ink-muted/30 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          />

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={isSaving}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
            >
              {isSaving ? "Saving…" : "Save annotation"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setComment("");
                setError(null);
              }}
              className="rounded-md border border-ink-muted/30 px-4 py-2 text-sm"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">
          Annotations{annotations.length > 0 ? ` (${annotations.length})` : ""}
        </h2>

        {annotations.length === 0 ? (
          <p className="text-sm text-ink-muted">
            None yet. Drag a rectangle over a passage above.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {annotations.map((annotation, index) => (
              <li key={annotation.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(annotation.id)}
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left ${
                    selectedId === annotation.id
                      ? "border-accent"
                      : "border-ink-muted/15"
                  }`}
                >
                  <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-paper">
                    {index + 1}
                  </span>

                  <span className="flex flex-1 flex-col gap-1">
                    <span className="text-sm">
                      {annotation.userComment || (
                        <span className="text-ink-muted">No note</span>
                      )}
                    </span>

                    {/* Phase 7 fills these in. Until then the status is the
                        honest answer: the row exists, the model has not run. */}
                    <span className="text-xs text-ink-muted">
                      {annotation.enrichmentStatus === "pending"
                        ? "Passage not extracted yet"
                        : annotation.enrichmentStatus === "failed"
                          ? "Extraction failed"
                          : annotation.extractedPassage}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
