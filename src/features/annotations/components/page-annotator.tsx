"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import type { PageId } from "@/db/ids";
import { buildOriginalProjection } from "@/features/pages/pages.projection";
import type { PageCorners } from "@/features/pages/pages.schema";

import {
  createAnnotationAction,
  updateAnnotationAction,
} from "../annotations.actions";
import {
  isRegionAnnotation,
  type Annotation,
  type NormalizedRect,
} from "../annotations.types";
import { AnnotationCanvas } from "./annotation-canvas";
import { useAnnotationEnrichment } from "./use-annotation-enrichment";
import { DeleteAnnotationButton } from "./delete-annotation-button";
import { OriginalPhotoAnnotationCanvas } from "./original-photo-annotation-canvas";
import {
  AnnotationExtraction,
  AnnotationCopyActions,
  AnnotationEditForm,
  AnnotationEnrichmentAction,
  formatAnnotationForClipboard,
  type AnnotationEditDraft,
  type CopyMode,
} from "./annotation-controls";

type PageAnnotatorProps = {
  pageId: PageId;
  imageUrl: string;
  originalImageUrl: string | null;
  originalPageCorners: PageCorners | null;
  imageStorageKey: string;
  imageWidth: number;
  imageHeight: number;
  annotations: Annotation[];
  initialSelectedId?: string;
  previousHref?: string;
  nextHref?: string;
};

/** 1 means the whole page is visible; larger steps widen the image wrapper. */
const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;

type PageImageView = "corrected" | "source";

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function PageAnnotator({
  pageId,
  imageUrl,
  originalImageUrl,
  originalPageCorners,
  imageStorageKey,
  imageWidth,
  imageHeight,
  annotations,
  initialSelectedId,
  previousHref,
  nextHref,
}: PageAnnotatorProps) {
  const router = useRouter();
  const [zoomIndex, setZoomIndex] = useState(0);
  const [pageImageView, setPageImageView] =
    useState<PageImageView>("corrected");
  const [scanLike, setScanLike] = useState(false);
  const [draft, setDraft] = useState<NormalizedRect | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    annotations.some((annotation) => annotation.id === initialSelectedId)
      ? (initialSelectedId ?? null)
      : null,
  );
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [isMarginOpen, setIsMarginOpen] = useState(true);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedAnnotationId, setCopiedAnnotationId] = useState<string | null>(
    null,
  );
  const [editDraft, setEditDraft] = useState<AnnotationEditDraft>({
    userComment: "",
    extractedPassage: "",
    extractedContext: "",
  });
  const [isSaving, startSaving] = useTransition();
  const [isUpdating, startUpdating] = useTransition();

  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;
  const isShowingOriginalPhoto =
    Boolean(originalImageUrl) && pageImageView === "source";
  const originalProjection = useMemo(
    () => buildOriginalProjection(originalPageCorners),
    [originalPageCorners],
  );
  // Only region anchors appear on the photograph, ordered down the page so the
  // margin notes read in the order the eye meets them. Text annotations belong
  // to the reading view and are listed there.
  const orderedAnnotations = useMemo(
    () =>
      annotations
        .filter(isRegionAnnotation)
        .sort((a, b) => a.rectY - b.rectY || a.rectX - b.rectX),
    [annotations],
  );
  const incompleteRegionAnnotations = orderedAnnotations.filter(
    (annotation) => annotation.enrichmentStatus !== "complete",
  );
  const failedRegionAnnotations = orderedAnnotations.filter(
    (annotation) => annotation.enrichmentStatus === "failed",
  );
  const { batchExtraction, enriching, enrich, extractMissingPassages } =
    useAnnotationEnrichment(incompleteRegionAnnotations, setError);
  const isBatchExtracting = batchExtraction?.status === "running";
  const isExtractionButtonDisabled =
    batchExtraction?.status === "running" ||
    batchExtraction?.status === "done" ||
    enriching.size > 0;

  useEffect(() => {
    if (!selectedId) return;
    document
      .getElementById(`annotation-${selectedId}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedId(null);
        setDraft(null);
        return;
      }

      if (isTypingTarget(event.target)) return;

      if (event.key === "ArrowLeft" && previousHref) {
        event.preventDefault();
        router.push(previousHref);
      } else if (event.key === "ArrowRight" && nextHref) {
        event.preventDefault();
        router.push(nextHref);
      } else if (
        (event.key === "j" || event.key === "k") &&
        orderedAnnotations.length > 0
      ) {
        event.preventDefault();
        const currentIndex = orderedAnnotations.findIndex(
          (annotation) => annotation.id === selectedId,
        );
        const delta = event.key === "j" ? 1 : -1;
        const nextIndex =
          currentIndex < 0
            ? event.key === "j"
              ? 0
              : orderedAnnotations.length - 1
            : Math.min(
                orderedAnnotations.length - 1,
                Math.max(0, currentIndex + delta),
              );
        const nextAnnotation = orderedAnnotations[nextIndex];

        if (nextAnnotation) {
          setSelectedId(nextAnnotation.id);
          setIsMarginOpen(true);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextHref, orderedAnnotations, previousHref, router, selectedId]);

  function save() {
    if (!draft) return;
    setError(null);

    startSaving(async () => {
      const result = await createAnnotationAction({
        pageId,
        imageStorageKey,
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

      if (result.createdId) void enrich(result.createdId);
    });
  }

  function startEdit(annotation: Annotation) {
    setEditingId(annotation.id);
    setEditError(null);
    setEditDraft({
      userComment: annotation.userComment,
      extractedPassage: annotation.extractedPassage ?? "",
      extractedContext: annotation.extractedContext ?? "",
    });
    setSelectedId(annotation.id);
    setIsMarginOpen(true);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
    setEditDraft({
      userComment: "",
      extractedPassage: "",
      extractedContext: "",
    });
  }

  function saveEdit(annotationId: string) {
    setEditError(null);

    startUpdating(async () => {
      const result = await updateAnnotationAction({
        annotationId,
        userComment: editDraft.userComment,
        extractedPassage: editDraft.extractedPassage,
        extractedContext: editDraft.extractedContext,
      });

      if (result.error) {
        setEditError(result.error);
        return;
      }

      cancelEdit();
      router.refresh();
    });
  }

  async function copyAnnotation(annotation: Annotation, mode: CopyMode) {
    const text = formatAnnotationForClipboard(annotation, mode);

    if (!text) {
      setError("There is nothing to copy yet.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopiedAnnotationId(annotation.id);
      setError(null);
      window.setTimeout(() => setCopiedAnnotationId(null), 1600);
    } catch {
      setError("The browser did not allow clipboard access.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="screen-only flex flex-wrap items-center gap-x-5 gap-y-3 border-y border-rule py-2.5">
        <div className="flex items-center text-sm">
          <button type="button" onClick={() => setZoomIndex((index) => Math.max(0, index - 1))} disabled={zoomIndex === 0} className="flex size-8 items-center justify-center border border-rule disabled:opacity-35" aria-label="Zoom out">−</button>
          <span className="w-14 text-center text-xs tabular-nums text-ink-muted">{zoom === 1 ? "Fit" : `${zoom}×`}</span>
          <button type="button" onClick={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))} disabled={zoomIndex === ZOOM_STEPS.length - 1} className="flex size-8 items-center justify-center border border-rule disabled:opacity-35" aria-label="Zoom in">+</button>
        </div>

        {originalImageUrl ? (
          <div
            role="group"
            aria-label="Page image"
            className="flex border border-rule text-xs uppercase tracking-[0.1em]"
          >
            {(
              [
                ["corrected", "Corrected page"],
                ["source", "Source photo"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={pageImageView === value}
                onClick={() => setPageImageView(value)}
                className={`px-3 py-1.5 ${
                  pageImageView === value
                    ? "bg-accent text-paper"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {!isShowingOriginalPhoto ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs uppercase tracking-[0.1em] text-ink-muted">
            <input
              type="checkbox"
              checked={scanLike}
              onChange={(event) => setScanLike(event.target.checked)}
              className="accent-accent"
            />
            Scan-like
          </label>
        ) : null}
        <p className="mr-auto text-sm text-ink-muted">
          {isShowingOriginalPhoto && !originalProjection
            ? "Source photograph. Use the corrected page to place notes on this older page."
            : "Drag across a passage to begin a note."}
        </p>
        {incompleteRegionAnnotations.length > 0 ? (
          <button
            type="button"
            onClick={extractMissingPassages}
            disabled={isExtractionButtonDisabled}
            className="text-xs uppercase tracking-[0.1em] text-accent underline decoration-accent/40 underline-offset-4 hover:text-ink disabled:text-ink-muted disabled:decoration-rule disabled:opacity-60"
          >
            {isBatchExtracting
              ? `Extracting ${batchExtraction.current}/${batchExtraction.total}`
              : failedRegionAnnotations.length > 0
                ? `Retry missing passages (${incompleteRegionAnnotations.length})`
                : `Extract missing passages (${incompleteRegionAnnotations.length})`}
          </button>
        ) : null}
        <button type="button" onClick={() => setIsMarginOpen((open) => !open)} className="text-xs uppercase tracking-[0.1em] text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink" aria-expanded={isMarginOpen}>
          {isMarginOpen ? "Hide notes" : `Show notes (${annotations.length})`}
        </button>
      </div>

      {error ? <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">{error}</p> : null}
      {batchExtraction ? (
        <p role="status" className="border-l-2 border-accent pl-3 text-sm text-ink-muted">
          {batchExtraction.message}
        </p>
      ) : null}

      <div className={`annotation-layout grid items-start gap-6 ${isMarginOpen ? "lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]" : "grid-cols-1"}`}>
        <div className="annotation-canvas-region min-w-0">
          {isShowingOriginalPhoto && originalImageUrl ? (
            <OriginalPhotoAnnotationCanvas
              imageUrl={originalImageUrl}
              zoom={zoom}
              projection={originalProjection}
              annotations={orderedAnnotations}
              draft={draft}
              selectedId={selectedId}
              highlightedId={highlightedId ?? selectedId}
              onSelect={(id) => { setSelectedId(id); if (id) setIsMarginOpen(true); }}
              onHighlight={setHighlightedId}
              onDraftChange={(rect) => { setDraft(rect); if (rect) setIsMarginOpen(true); }}
            />
          ) : (
            <AnnotationCanvas
              imageUrl={imageUrl}
              imageStorageKey={imageStorageKey}
              imageWidth={imageWidth}
              imageHeight={imageHeight}
              zoom={zoom}
              scanLike={scanLike}
              annotations={orderedAnnotations}
              draft={draft}
              selectedId={selectedId}
              highlightedId={highlightedId ?? selectedId}
              onSelect={(id) => { setSelectedId(id); if (id) setIsMarginOpen(true); }}
              onHighlight={setHighlightedId}
              onDraftChange={(rect) => { setDraft(rect); if (rect) setIsMarginOpen(true); }}
            />
          )}
        </div>

        {isMarginOpen ? (
          <aside className="annotation-margin min-w-0 border-t border-rule pt-4 lg:max-h-[82vh] lg:overflow-y-auto lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="font-serif text-xl">Margin notes</h2>
              <span className="text-xs tabular-nums text-ink-muted">{annotations.length}</span>
            </div>

            {draft ? (
              <section className="mb-5 border-y border-accent py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">New annotation</h3>
                  <p className="font-mono text-xs text-ink-muted">x {formatPercent(draft.x)} · y {formatPercent(draft.y)} · w {formatPercent(draft.width)} · h {formatPercent(draft.height)}</p>
                </div>
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="What do you want to remember?" rows={4} autoFocus className="mt-3 w-full resize-y border border-rule bg-paper-raised px-3 py-2 text-sm outline-none focus:border-accent" />
                <div className="mt-3 flex gap-3">
                  <button type="button" onClick={save} disabled={isSaving} className="bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-60">{isSaving ? "Saving…" : "Save annotation"}</button>
                  <button type="button" onClick={() => { setDraft(null); setComment(""); setError(null); }} className="text-sm text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink">Discard</button>
                </div>
              </section>
            ) : null}

            {orderedAnnotations.length === 0 ? (
              <p className="max-w-[32ch] text-sm leading-6 text-ink-muted">Drag over a line on the page. Its note will appear here beside the text it belongs to.</p>
            ) : (
              <ol className="flex flex-col">
                {orderedAnnotations.map((annotation, index) => {
                  const isActive = (highlightedId ?? selectedId) === annotation.id;
                  return (
                    <li
                      id={`annotation-${annotation.id}`}
                      key={annotation.id}
                      className={`annotation-card flex items-start gap-3 border-t py-4 first:border-t-0 ${isActive ? "border-l-2 border-l-accent pl-3" : "border-l-2 border-l-transparent pl-3"}`}
                      onMouseEnter={() => setHighlightedId(annotation.id)}
                      onMouseLeave={() => setHighlightedId(null)}
                      onFocus={() => setHighlightedId(annotation.id)}
                      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHighlightedId(null); }}
                    >
                      <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs ${isActive ? "bg-accent text-paper" : "border border-accent text-accent"}`}>{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        {editingId === annotation.id ? (
                          <AnnotationEditForm
                            draft={editDraft}
                            error={editError}
                            isSaving={isUpdating}
                            onChange={setEditDraft}
                            onCancel={cancelEdit}
                            onSave={() => saveEdit(annotation.id)}
                          />
                        ) : (
                          <>
                            <button type="button" onClick={() => setSelectedId(annotation.id)} className="block w-full text-left">
                              <span className={`block text-sm leading-6 ${annotation.userComment ? "text-ink" : "italic text-ink-muted"}`}>{annotation.userComment || "No note was added."}</span>
                              <AnnotationExtraction annotation={annotation} isEnriching={enriching.has(annotation.id)} />
                            </button>
                            <AnnotationCopyActions
                              annotation={annotation}
                              copied={copiedAnnotationId === annotation.id}
                              onCopy={(mode) => copyAnnotation(annotation, mode)}
                            />
                            <AnnotationEnrichmentAction annotation={annotation} isEnriching={enriching.has(annotation.id)} onEnrich={enrich} />
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                              <button type="button" onClick={() => startEdit(annotation)} className="text-xs text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink">Edit note/extraction</button>
                              <DeleteAnnotationButton id={annotation.id} />
                            </div>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
