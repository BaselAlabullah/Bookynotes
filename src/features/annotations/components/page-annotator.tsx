"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type { PageId } from "@/db/ids";
import { canonicalPageCorners } from "@/features/pages/pages.projection";

import {
  createAnnotationAction,
  updateAnnotationAction,
} from "../annotations.actions";
import { enrichResponseSchema } from "../annotations.schema";
import {
  isRegionAnnotation,
  type Annotation,
  type NormalizedRect,
} from "../annotations.types";
import { AnnotationCanvas } from "./annotation-canvas";
import { DeleteAnnotationButton } from "./delete-annotation-button";

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
const MIN_SELECTION_SIZE = 0.005;
const ORIGINAL_FIT_HEIGHT_VH = 78;

type Point = { x: number; y: number };
type PageCorners = [Point, Point, Point, Point];
type HomographyMatrix = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
type Projection = {
  scanRectToOriginalRect: (rect: NormalizedRect) => NormalizedRect;
  originalRectToScanRect: (rect: NormalizedRect) => NormalizedRect | null;
};

type AnnotationEditDraft = {
  userComment: string;
  extractedPassage: string;
  extractedContext: string;
};

type BatchExtractionState = {
  status: "running" | "done" | "stopped";
  current: number;
  total: number;
  message: string;
} | null;

type EnrichmentRequestResult = {
  ok: boolean;
  message: string | null;
};

type CopyMode = "note" | "passage" | "all";
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
  const [batchExtraction, setBatchExtraction] =
    useState<BatchExtractionState>(null);
  const [isSaving, startSaving] = useTransition();
  const [isUpdating, startUpdating] = useTransition();
  const [enriching, setEnriching] = useState<ReadonlySet<string>>(new Set());

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

  async function requestEnrichment(
    annotationId: string,
    force = false,
  ): Promise<EnrichmentRequestResult> {
    const response = await fetch(
      `/api/annotations/${annotationId}/enrich${force ? "?force=true" : ""}`,
      { method: "POST" },
    );
    const body = enrichResponseSchema.safeParse(await response.json());

    if (!response.ok) {
      return {
        ok: false,
        message:
          body.success && body.data.error
            ? body.data.error
            : "The passage could not be extracted.",
      };
    }

    return { ok: true, message: null };
  }

  async function enrich(annotationId: string, force = false) {
    setEnriching((current) => new Set(current).add(annotationId));

    try {
      const result = await requestEnrichment(annotationId, force);

      if (!result.ok) {
        setError(result.message);
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
      router.refresh();
    }
  }

  async function extractMissingPassages() {
    const queue = incompleteRegionAnnotations;

    if (queue.length === 0) {
      return;
    }

    setError(null);
    setBatchExtraction({
      status: "running",
      current: 0,
      total: queue.length,
      message: "Starting extraction queue...",
    });

    for (const [index, annotation] of queue.entries()) {
      const force = annotation.enrichmentStatus === "failed";

      setBatchExtraction({
        status: "running",
        current: index + 1,
        total: queue.length,
        message: force
          ? `Retrying note ${index + 1} of ${queue.length}...`
          : `Reading note ${index + 1} of ${queue.length}...`,
      });
      setEnriching((current) => new Set(current).add(annotation.id));

      try {
        const result = await requestEnrichment(annotation.id, force);

        if (!result.ok) {
          setError(result.message);
          setBatchExtraction({
            status: "stopped",
            current: index + 1,
            total: queue.length,
            message:
              result.message ??
              "Extraction stopped. You can run the queue again later.",
          });
          router.refresh();
          return;
        }
      } catch {
        setError("Could not reach the extraction service.");
        setBatchExtraction({
          status: "stopped",
          current: index + 1,
          total: queue.length,
          message: "Extraction stopped because the service could not be reached.",
        });
        router.refresh();
        return;
      } finally {
        setEnriching((current) => {
          const next = new Set(current);
          next.delete(annotation.id);
          return next;
        });
      }
    }

    setBatchExtraction({
      status: "done",
      current: queue.length,
      total: queue.length,
      message: "All missing passages were extracted.",
    });
    router.refresh();
  }

  function save() {
    if (!draft) return;
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
                  <p className="font-mono text-[10px] text-ink-muted">x {formatPercent(draft.x)} · y {formatPercent(draft.y)} · w {formatPercent(draft.width)} · h {formatPercent(draft.height)}</p>
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
                      <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] ${isActive ? "bg-accent text-paper" : "border border-accent text-accent"}`}>{index + 1}</span>
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

function OriginalPhotoAnnotationCanvas({
  imageUrl,
  zoom,
  projection,
  annotations,
  draft,
  selectedId,
  highlightedId,
  onSelect,
  onHighlight,
  onDraftChange,
}: {
  imageUrl: string;
  zoom: number;
  projection: Projection | null;
  annotations: Annotation[];
  draft: NormalizedRect | null;
  selectedId: string | null;
  highlightedId: string | null;
  onSelect: (id: string | null) => void;
  onHighlight: (id: string | null) => void;
  onDraftChange: (rect: NormalizedRect | null) => void;
}) {
  const startRef = useRef<Point | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const canDraw = Boolean(projection);

  function toNormalized(event: React.PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();

    return {
      x: clamp01((event.clientX - box.left) / box.width),
      y: clamp01((event.clientY - box.top) / box.height),
    };
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!canDraw || event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = toNormalized(event);
    setIsDrawing(true);
    onSelect(null);
    onDraftChange(null);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const start = startRef.current;

    if (!isDrawing || !start || !projection) {
      return;
    }

    onDraftChange(
      projection.originalRectToScanRect(
        rectBetween(start, toNormalized(event)),
      ),
    );
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const start = startRef.current;

    if (!isDrawing || !start || !projection) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    setIsDrawing(false);
    startRef.current = null;

    const displayRect = rectBetween(start, toNormalized(event));
    const storedRect =
      displayRect.width < MIN_SELECTION_SIZE &&
      displayRect.height < MIN_SELECTION_SIZE
        ? null
        : projection.originalRectToScanRect(displayRect);

    onDraftChange(storedRect);
  }

  const displayedDraft =
    projection && draft ? projection.scanRectToOriginalRect(draft) : null;

  return (
    <div className="max-h-[82vh] overflow-auto bg-paper-deep/50 shadow-inner">
      <div className="relative mx-auto w-fit">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Original page photograph"
          className="block max-w-none select-none"
          draggable={false}
          style={{ height: `${ORIGINAL_FIT_HEIGHT_VH * zoom}vh`, width: "auto" }}
        />

        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className={`absolute inset-0 h-full w-full touch-none ${
            canDraw ? "cursor-crosshair" : "cursor-not-allowed"
          }`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-label={
            canDraw
              ? "Draw an annotation on the original photograph"
              : "Original photograph cannot be annotated because no page corners were saved"
          }
        >
          {projection
            ? annotations.filter(isRegionAnnotation).map((annotation) => {
                const rect = projection.scanRectToOriginalRect({
                  x: annotation.rectX,
                  y: annotation.rectY,
                  width: annotation.rectWidth,
                  height: annotation.rectHeight,
                });

                return (
                  <rect
                    key={annotation.id}
                    x={rect.x}
                    y={rect.y}
                    width={rect.width}
                    height={rect.height}
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={highlightedId === annotation.id ? 3 : 1.5}
                    className={
                      highlightedId === annotation.id
                        ? "fill-accent/20 stroke-accent"
                        : "fill-accent/5 stroke-accent/70 hover:fill-accent/15"
                    }
                    role="button"
                    tabIndex={0}
                    aria-label={`Select annotation ${annotations.indexOf(annotation) + 1}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerEnter={() => onHighlight(annotation.id)}
                    onPointerLeave={() => onHighlight(null)}
                    onFocus={() => onHighlight(annotation.id)}
                    onBlur={() => onHighlight(null)}
                    onPointerUp={(event) => {
                      event.stopPropagation();
                      onSelect(annotation.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(annotation.id);
                      }
                    }}
                  />
                );
              })
            : null}

          {displayedDraft ? (
            <rect
              x={displayedDraft.x}
              y={displayedDraft.y}
              width={displayedDraft.width}
              height={displayedDraft.height}
              vectorEffect="non-scaling-stroke"
              strokeWidth={2}
              strokeDasharray="6 4"
              className="fill-accent/10 stroke-accent"
            />
          ) : null}
        </svg>

        {projection
          ? annotations.filter(isRegionAnnotation).map((annotation, index) => {
              const rect = projection.scanRectToOriginalRect({
                x: annotation.rectX,
                y: annotation.rectY,
                width: annotation.rectWidth,
                height: annotation.rectHeight,
              });

              return (
                <span
                  key={annotation.id}
                  aria-hidden
                  className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    selectedId === annotation.id
                      ? "bg-accent text-paper"
                      : "bg-paper-raised text-accent ring-1 ring-accent"
                  }`}
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                  }}
                >
                  {index + 1}
                </span>
              );
            })
          : null}
      </div>
    </div>
  );
}

function buildOriginalProjection(corners: PageCorners | null): Projection | null {
  if (!corners) {
    return null;
  }

  // The processor pulls the crop edge inward by 0.5% before warping. Use the
  // same corners here so overlays on the retained photograph match the pixels
  // that actually became the reading image.
  const ordered = canonicalPageCorners(corners);
  const scanCorners: PageCorners = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const scanToOriginal = findHomography(scanCorners, ordered);
  const originalToScan = findHomography(ordered, scanCorners);

  if (!scanToOriginal || !originalToScan) {
    return null;
  }

  return {
    scanRectToOriginalRect: (rect) =>
      rectFromProjectedCorners(rect, (point) => projectPoint(point, scanToOriginal)),
    originalRectToScanRect: (rect) => {
      const projected = rectFromProjectedCorners(rect, (point) =>
        projectPoint(point, originalToScan),
      );

      return projected.width < MIN_SELECTION_SIZE &&
        projected.height < MIN_SELECTION_SIZE
        ? null
        : projected;
    },
  };
}

function findHomography(from: PageCorners, to: PageCorners): HomographyMatrix | null {
  const matrix: number[][] = [];

  for (let index = 0; index < 4; index += 1) {
    const source = from[index]!;
    const target = to[index]!;

    matrix.push([
      source.x,
      source.y,
      1,
      0,
      0,
      0,
      -target.x * source.x,
      -target.x * source.y,
      target.x,
    ]);
    matrix.push([
      0,
      0,
      0,
      source.x,
      source.y,
      1,
      -target.y * source.x,
      -target.y * source.y,
      target.y,
    ]);
  }

  const solution = solveLinearSystem(matrix);

  return solution
    ? [
        solution[0],
        solution[1],
        solution[2],
        solution[3],
        solution[4],
        solution[5],
        solution[6],
        solution[7],
        1,
      ]
    : null;
}

function solveLinearSystem(matrix: number[][]): [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] | null {
  const size = matrix.length;

  for (let column = 0; column < size; column += 1) {
    let pivot = column;

    for (let row = column + 1; row < size; row += 1) {
      if (
        Math.abs(matrix[row]![column]!) > Math.abs(matrix[pivot]![column]!)
      ) {
        pivot = row;
      }
    }

    if (Math.abs(matrix[pivot]![column]!) < 1e-12) {
      return null;
    }

    [matrix[column], matrix[pivot]] = [matrix[pivot]!, matrix[column]!];

    const divisor = matrix[column]![column]!;

    for (let cell = column; cell <= size; cell += 1) {
      matrix[column]![cell] = matrix[column]![cell]! / divisor;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue;
      }

      const factor = matrix[row]![column]!;

      for (let cell = column; cell <= size; cell += 1) {
        matrix[row]![cell] =
          matrix[row]![cell]! - factor * matrix[column]![cell]!;
      }
    }
  }

  return [
    matrix[0]![size]!,
    matrix[1]![size]!,
    matrix[2]![size]!,
    matrix[3]![size]!,
    matrix[4]![size]!,
    matrix[5]![size]!,
    matrix[6]![size]!,
    matrix[7]![size]!,
  ];
}

function projectPoint(point: Point, matrix: HomographyMatrix) {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];

  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  };
}

function rectFromProjectedCorners(
  rect: NormalizedRect,
  project: (point: Point) => Point,
): NormalizedRect {
  const points = [
    project({ x: rect.x, y: rect.y }),
    project({ x: rect.x + rect.width, y: rect.y }),
    project({ x: rect.x + rect.width, y: rect.y + rect.height }),
    project({ x: rect.x, y: rect.y + rect.height }),
  ];
  const left = clamp01(Math.min(...points.map((point) => point.x)));
  const right = clamp01(Math.max(...points.map((point) => point.x)));
  const top = clamp01(Math.min(...points.map((point) => point.y)));
  const bottom = clamp01(Math.max(...points.map((point) => point.y)));

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function rectBetween(a: Point, b: Point): NormalizedRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

/** What the model found, or an honest account of why it has not yet. */
function AnnotationExtraction({ annotation, isEnriching }: { annotation: Annotation; isEnriching: boolean }) {
  if (isEnriching) return <span role="status" className="mt-2 block text-xs italic text-ink-muted">Reading the passage…</span>;
  if (annotation.enrichmentStatus === "pending") {
    const attempts =
      annotation.retryCount > 0
        ? ` Attempt ${annotation.retryCount + 1} will run next.`
        : "";

    return (
      <span className="mt-2 block text-xs italic text-ink-muted">
        Passage not extracted yet.
        {annotation.enrichmentError ? ` Last issue: ${annotation.enrichmentError}` : ""}
        {attempts}
      </span>
    );
  }
  if (annotation.enrichmentStatus === "failed") {
    return (
      <span className="mt-2 block text-xs italic text-danger">
        Extraction failed after {annotation.retryCount}{" "}
        {annotation.retryCount === 1 ? "attempt" : "attempts"}.
        {annotation.enrichmentError ? ` ${annotation.enrichmentError}` : ""}
      </span>
    );
  }
  return <AnnotationReviewBlocks annotation={annotation} />;
}

function AnnotationReviewBlocks({ annotation }: { annotation: Annotation }) {
  if (!annotation.extractedPassage && !annotation.extractedContext) {
    return null;
  }

  return (
    <span className="mt-3 flex flex-col gap-3">
      {annotation.extractedPassage ? (
        <span className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-muted">
            Read passage
          </span>
          <span className="font-serif text-[0.95rem] leading-6 text-ink-muted">
            “{annotation.extractedPassage}”
          </span>
        </span>
      ) : null}

      {annotation.extractedContext ? (
        <span className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-muted">
            Context
          </span>
          <span className="text-xs leading-5 text-ink-muted">
            {annotation.extractedContext}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function AnnotationCopyActions({
  annotation,
  copied,
  onCopy,
}: {
  annotation: Annotation;
  copied: boolean;
  onCopy: (mode: CopyMode) => void;
}) {
  const hasNote = annotation.userComment.trim().length > 0;
  const hasPassage =
    Boolean(annotation.extractedPassage?.trim()) ||
    Boolean(annotation.extractedContext?.trim());

  if (!hasNote && !hasPassage) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
      {hasNote ? (
        <button
          type="button"
          onClick={() => onCopy("note")}
          className="text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink"
        >
          Copy note
        </button>
      ) : null}
      {hasPassage ? (
        <button
          type="button"
          onClick={() => onCopy("passage")}
          className="text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink"
        >
          Copy passage
        </button>
      ) : null}
      {hasNote && hasPassage ? (
        <button
          type="button"
          onClick={() => onCopy("all")}
          className="text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink"
        >
          Copy all
        </button>
      ) : null}
      {copied ? (
        <span role="status" className="text-accent">
          Copied
        </span>
      ) : null}
    </div>
  );
}

function formatAnnotationForClipboard(
  annotation: Annotation,
  mode: CopyMode,
) {
  const note = annotation.userComment.trim();
  const passage = annotation.extractedPassage?.trim() ?? "";
  const context = annotation.extractedContext?.trim() ?? "";

  if (mode === "note") {
    return note;
  }

  if (mode === "passage") {
    return [passage ? `Passage:\n${passage}` : "", context ? `Context:\n${context}` : ""]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    note ? `Note:\n${note}` : "",
    passage ? `Passage:\n${passage}` : "",
    context ? `Context:\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function AnnotationEditForm({
  draft,
  error,
  isSaving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: AnnotationEditDraft;
  error: string | null;
  isSaving: boolean;
  onChange: (draft: AnnotationEditDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <section className="flex flex-col gap-3 border-y border-accent/50 py-3">
      <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.12em] text-ink-muted">
        Note
        <textarea
          value={draft.userComment}
          onChange={(event) =>
            onChange({ ...draft, userComment: event.target.value })
          }
          rows={3}
          className="resize-y border border-rule bg-paper-raised px-3 py-2 text-sm normal-case leading-6 tracking-normal text-ink outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.12em] text-ink-muted">
        Passage
        <textarea
          value={draft.extractedPassage}
          onChange={(event) =>
            onChange({ ...draft, extractedPassage: event.target.value })
          }
          rows={3}
          className="resize-y border border-rule bg-paper-raised px-3 py-2 font-serif text-sm normal-case leading-6 tracking-normal text-ink outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.12em] text-ink-muted">
        Context
        <textarea
          value={draft.extractedContext}
          onChange={(event) =>
            onChange({ ...draft, extractedContext: event.target.value })
          }
          rows={3}
          className="resize-y border border-rule bg-paper-raised px-3 py-2 text-sm normal-case leading-6 tracking-normal text-ink outline-none focus:border-accent"
        />
      </label>

      {error ? (
        <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save edits"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="text-sm text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

function AnnotationEnrichmentAction({ annotation, isEnriching, onEnrich }: { annotation: Annotation; isEnriching: boolean; onEnrich: (annotationId: string, force?: boolean) => void }) {
  if (isEnriching || annotation.enrichmentStatus === "complete") return null;
  const isRetry = annotation.enrichmentStatus === "failed";
  return <button type="button" onClick={() => onEnrich(annotation.id, isRetry)} className="mt-3 text-xs font-medium text-accent underline decoration-accent/40 underline-offset-4">{isRetry ? "Try extraction again" : "Extract passage"}</button>;
}
