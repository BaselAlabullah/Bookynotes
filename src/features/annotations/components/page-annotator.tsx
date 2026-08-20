"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { PageId } from "@/db/ids";

import { createAnnotationAction } from "../annotations.actions";
import { enrichResponseSchema } from "../annotations.schema";
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

export function PageAnnotator({
  pageId,
  imageUrl,
  imageWidth,
  imageHeight,
  annotations,
}: PageAnnotatorProps) {
  const router = useRouter();
  const [zoomIndex, setZoomIndex] = useState(0);
  const [scanView, setScanView] = useState(false);
  const [draft, setDraft] = useState<NormalizedRect | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  /** Ids currently being enriched, so each row can show its own spinner. */
  const [enriching, setEnriching] = useState<ReadonlySet<string>>(new Set());

  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;

  /**
   * Ask the server to run the model over one annotation.
   *
   * A separate request from the write, always — that is the rule the whole
   * pipeline is built around. If this never runs, or fails, the annotation is
   * still saved and still correct; it simply has no passage yet.
   */
  async function enrich(annotationId: string, force = false) {
    setEnriching((current) => new Set(current).add(annotationId));

    try {
      const response = await fetch(
        `/api/annotations/${annotationId}/enrich${force ? "?force=true" : ""}`,
        { method: "POST" },
      );

      const body = enrichResponseSchema.safeParse(await response.json());

      if (!response.ok) {
        setError(
          body.success && body.data.error
            ? body.data.error
            : "The passage could not be extracted.",
        );
      } else {
        setError(null);
      }
    } catch {
      setError("Could not reach the extraction service.");
    } finally {
      setEnriching((current) => {
        const next = new Set(current);
        next.delete(annotationId);
        return next;
      });
      // The list is server-rendered, so ask the server for it again rather than
      // keeping a client-side copy of the row in step.
      router.refresh();
    }
  }

  function save() {
    if (!draft) {
      return;
    }

    setError(null);

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

      // Kick off extraction now that the row exists. Deliberately not awaited
      // inside the same call that wrote it: the write is already done and
      // durable, and this is allowed to take as long as it takes.
      if (result.createdId) {
        void enrich(result.createdId);
      }
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

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={scanView}
            onChange={(event) => setScanView(event.target.checked)}
          />
          Scan view
        </label>

        <p className="text-sm text-ink-muted">
          Drag across a passage to mark it.
        </p>
      </div>

      <AnnotationCanvas
        imageUrl={imageUrl}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        zoom={zoom}
        scanView={scanView}
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

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
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
              <li
                key={annotation.id}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  selectedId === annotation.id
                    ? "border-accent"
                    : "border-ink-muted/15"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(annotation.id)}
                  className="flex flex-1 flex-col items-start gap-2 text-left"
                >
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-paper">
                      {index + 1}
                    </span>
                    <span className="text-sm">
                      {annotation.userComment || (
                        <span className="text-ink-muted">No note</span>
                      )}
                    </span>
                  </span>

                  <AnnotationExtraction
                    annotation={annotation}
                    isEnriching={enriching.has(annotation.id)}
                  />
                </button>

                <AnnotationEnrichmentAction
                  annotation={annotation}
                  isEnriching={enriching.has(annotation.id)}
                  onEnrich={enrich}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** What the model found, or an honest account of why it has not yet. */
function AnnotationExtraction({
  annotation,
  isEnriching,
}: {
  annotation: Annotation;
  isEnriching: boolean;
}) {
  if (isEnriching) {
    return (
      <span role="status" className="text-xs text-ink-muted">
        Reading the passage…
      </span>
    );
  }

  if (annotation.enrichmentStatus === "pending") {
    return (
      <span className="text-xs text-ink-muted">
        Passage not extracted yet
        {annotation.enrichmentError ? ` — ${annotation.enrichmentError}` : ""}
      </span>
    );
  }

  if (annotation.enrichmentStatus === "failed") {
    return (
      <span className="text-xs text-red-600">
        {annotation.enrichmentError ?? "Extraction failed."}
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-1">
      {annotation.extractedPassage ? (
        <span className="border-l-2 border-accent/40 pl-2 text-sm italic">
          “{annotation.extractedPassage}”
        </span>
      ) : null}
      {annotation.extractedContext ? (
        <span className="text-xs text-ink-muted">
          {annotation.extractedContext}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The retry affordance.
 *
 * A 'failed' annotation is never a dead end — the user can always ask again,
 * and asking again resets the attempt budget. A 'pending' one gets a plain
 * "Extract" button, which is what makes an interrupted or abandoned enrichment
 * recoverable rather than stuck.
 */
function AnnotationEnrichmentAction({
  annotation,
  isEnriching,
  onEnrich,
}: {
  annotation: Annotation;
  isEnriching: boolean;
  onEnrich: (annotationId: string, force?: boolean) => void;
}) {
  if (isEnriching || annotation.enrichmentStatus === "complete") {
    return null;
  }

  const isRetry = annotation.enrichmentStatus === "failed";

  return (
    <button
      type="button"
      onClick={() => onEnrich(annotation.id, isRetry)}
      className="shrink-0 rounded-md border border-accent px-3 py-1.5 text-xs text-accent"
    >
      {isRetry ? "Try again" : "Extract passage"}
    </button>
  );
}
