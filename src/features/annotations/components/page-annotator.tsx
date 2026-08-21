"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import type { PageId } from "@/db/ids";

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

type AnnotationEditDraft = {
  userComment: string;
  extractedPassage: string;
  extractedContext: string;
};

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
  const [scanView, setScanView] = useState(false);
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
  const [editDraft, setEditDraft] = useState<AnnotationEditDraft>({
    userComment: "",
    extractedPassage: "",
    extractedContext: "",
  });
  const [isSaving, startSaving] = useTransition();
  const [isUpdating, startUpdating] = useTransition();
  const [enriching, setEnriching] = useState<ReadonlySet<string>>(new Set());

  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;
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
      router.refresh();
    }
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

  return (
    <div className="flex flex-col gap-4">
      <div className="screen-only flex flex-wrap items-center gap-x-5 gap-y-3 border-y border-rule py-2.5">
        <div className="flex items-center text-sm">
          <button type="button" onClick={() => setZoomIndex((index) => Math.max(0, index - 1))} disabled={zoomIndex === 0} className="flex size-8 items-center justify-center border border-rule disabled:opacity-35" aria-label="Zoom out">−</button>
          <span className="w-14 text-center text-xs tabular-nums text-ink-muted">{zoom === 1 ? "Fit" : `${zoom}×`}</span>
          <button type="button" onClick={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))} disabled={zoomIndex === ZOOM_STEPS.length - 1} className="flex size-8 items-center justify-center border border-rule disabled:opacity-35" aria-label="Zoom in">+</button>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs uppercase tracking-[0.1em] text-ink-muted">
          <input type="checkbox" checked={scanView} onChange={(event) => setScanView(event.target.checked)} className="accent-accent" />
          Scan view
        </label>
        <p className="mr-auto text-sm text-ink-muted">Drag across a passage to begin a note.</p>
        <button type="button" onClick={() => setIsMarginOpen((open) => !open)} className="text-xs uppercase tracking-[0.1em] text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink" aria-expanded={isMarginOpen}>
          {isMarginOpen ? "Hide notes" : `Show notes (${annotations.length})`}
        </button>
      </div>

      {error ? <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">{error}</p> : null}

      <div className={`annotation-layout grid items-start gap-6 ${isMarginOpen ? "lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]" : "grid-cols-1"}`}>
        <div className="annotation-canvas-region min-w-0">
          <AnnotationCanvas
            imageUrl={imageUrl}
            imageStorageKey={imageStorageKey}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            zoom={zoom}
            scanView={scanView}
            annotations={orderedAnnotations}
            draft={draft}
            selectedId={selectedId}
            highlightedId={highlightedId ?? selectedId}
            onSelect={(id) => { setSelectedId(id); if (id) setIsMarginOpen(true); }}
            onHighlight={setHighlightedId}
            onDraftChange={(rect) => { setDraft(rect); if (rect) setIsMarginOpen(true); }}
          />
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

/** What the model found, or an honest account of why it has not yet. */
function AnnotationExtraction({ annotation, isEnriching }: { annotation: Annotation; isEnriching: boolean }) {
  if (isEnriching) return <span role="status" className="mt-2 block text-xs italic text-ink-muted">Reading the passage…</span>;
  if (annotation.enrichmentStatus === "pending") {
    return <span className="mt-2 block text-xs italic text-ink-muted">Passage not extracted yet{annotation.enrichmentError ? ` — ${annotation.enrichmentError}` : ""}</span>;
  }
  if (annotation.enrichmentStatus === "failed") {
    return <span className="mt-2 block text-xs italic text-danger">{annotation.enrichmentError ?? "Extraction failed."}</span>;
  }
  return (
    <span className="mt-2 flex flex-col gap-2">
      {annotation.extractedPassage ? <span className="font-serif text-[0.95rem] leading-6 text-ink-muted">“{annotation.extractedPassage}”</span> : null}
      {annotation.extractedContext ? <span className="text-xs leading-5 text-ink-muted">{annotation.extractedContext}</span> : null}
    </span>
  );
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
