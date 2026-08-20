"use client";

import { useRef, useState } from "react";

import {
  isRegionAnnotation,
  type Annotation,
  type NormalizedRect,
} from "../annotations.types";

type AnnotationCanvasProps = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  /** 1 = fit to column. Scrolling the container is how panning happens. */
  zoom: number;
  /**
   * Render the photograph as if it had been scanned: grayscale with the
   * contrast pushed up.
   *
   * This is a display filter and nothing more. It changes no pixel geometry, so
   * every stored coordinate stays valid — which is exactly why it is done in
   * CSS rather than by producing a "cleaned" image, which would move the page
   * out from under its own annotations.
   */
  scanView: boolean;
  annotations: Annotation[];
  draft: NormalizedRect | null;
  selectedId: string | null;
  highlightedId: string | null;
  onSelect: (id: string | null) => void;
  onHighlight: (id: string | null) => void;
  onDraftChange: (rect: NormalizedRect | null) => void;
};

/**
 * Anything smaller than this in both directions is a click, not a selection.
 * Purely a UI judgement — the database only insists on greater than zero.
 */
const MIN_SIZE = 0.005;

/**
 * How much of the viewport height a page may occupy at 1x zoom.
 *
 * This is what makes 1x mean "the whole page", rather than "as wide as the
 * column" — book pages are portrait, so filling the width of a text column
 * pushes most of the page below the fold.
 */
const FIT_HEIGHT_VH = 78;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The page image with an annotation overlay.
 *
 * The whole design turns on one choice: the SVG's viewBox is the unit square,
 * `0 0 1 1`. A stored rectangle of x 0.2, y 0.5, width 0.3, height 0.04 is
 * written into the SVG unchanged — the normalized coordinates in the database
 * are literally this element's coordinate system.
 *
 * What follows from that is the point:
 *
 * - Resizing the window re-projects every pin, and the browser does it. There
 *   is no ResizeObserver here and no re-render on resize, because there is
 *   nothing to recompute.
 * - Zooming does the same. Zoom widens the container, the SVG scales with it,
 *   and the pins keep their places for free.
 * - There is no projection code on the render path, so there is no projection
 *   code on the render path to get wrong.
 *
 * `preserveAspectRatio="none"` is deliberate: x and y must scale
 * independently, because a normalized x is a fraction of the width and a
 * normalized y is a fraction of the height, and those are different numbers of
 * pixels.
 *
 * Labels are HTML rather than SVG text for the same reason. Non-uniform
 * scaling would stretch glyphs; percentage offsets on absolutely positioned
 * HTML use exactly the same normalized numbers and stay legible.
 */
export function AnnotationCanvas({
  imageUrl,
  imageWidth,
  imageHeight,
  zoom,
  scanView,
  annotations,
  draft,
  selectedId,
  highlightedId,
  onSelect,
  onHighlight,
  onDraftChange,
}: AnnotationCanvasProps) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  /**
   * Screen coordinates to normalized image coordinates.
   *
   * `getBoundingClientRect()` is what makes this correct under both zoom and
   * scroll: it reports the element's actual painted box, so the divisor is
   * always the size the user is really looking at. Nothing here needs to know
   * the zoom level, the scroll offset, or the image's pixel dimensions — which
   * is why zoom can change without this function changing at all.
   */
  function toNormalized(event: React.PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();

    return {
      x: clamp01((event.clientX - box.left) / box.width),
      y: clamp01((event.clientY - box.top) / box.height),
    };
  }

  function rectBetween(
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): NormalizedRect {
    // Dragging up or left produces a negative delta, so the corners are sorted
    // rather than subtracted. Width and height have to be positive: the
    // database has a check constraint saying so.
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    // Only the primary button draws; a right click should not start a
    // selection.
    if (event.button !== 0) {
      return;
    }

    // Pointer capture keeps the drag working when the pointer leaves the image,
    // including past the window edge, and guarantees the matching pointerup
    // arrives here rather than at whatever is underneath.
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = toNormalized(event);
    setIsDrawing(true);
    onSelect(null);
    onDraftChange(null);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const start = startRef.current;

    if (!isDrawing || !start) {
      return;
    }

    onDraftChange(rectBetween(start, toNormalized(event)));
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const start = startRef.current;

    if (!isDrawing || !start) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    setIsDrawing(false);
    startRef.current = null;

    const rect = rectBetween(start, toNormalized(event));

    onDraftChange(rect.width < MIN_SIZE && rect.height < MIN_SIZE ? null : rect);
  }

  // The width at which this page would be exactly `FIT_HEIGHT_VH * zoom` tall,
  // derived from the intrinsic dimensions we already store. Nothing is measured
  // from the DOM — the aspect ratio is a property of the file, known before the
  // image has even loaded.
  const heightLimitedWidth = `calc(${FIT_HEIGHT_VH * zoom}vh * ${imageWidth} / ${imageHeight})`;

  return (
    <div className="max-h-[82vh] overflow-auto bg-paper-deep/50 shadow-inner">
      {/*
        Sizing this wrapper is the entire zoom implementation. The image is
        w-full, the SVG is stretched over it, and the badges are positioned in
        percentages, so all three scale together and stay aligned. Panning is
        the container's own scrollbars, which costs no code and behaves the way
        the platform already does.

        Two limits apply, and 1x is whichever binds first — so the default view
        is the whole page, not a column-wide slice of a tall one:
          width    the column, times the zoom
          maxWidth the width at which the page is as tall as we allow
      */}
      <div
        className="relative mx-auto"
        style={{
          width: `${zoom * 100}%`,
          maxWidth: heightLimitedWidth,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Page photograph"
          width={imageWidth}
          height={imageHeight}
          className="block h-auto w-full select-none"
          draggable={false}
          style={
            scanView
              ? { filter: "grayscale(1) contrast(1.4) brightness(1.06)" }
              : undefined
          }
        />

        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Only region anchors belong on the photograph. A text annotation
              is anchored to characters in the transcript and has no rectangle
              to draw. */}
          {annotations.filter(isRegionAnnotation).map((annotation) => (
            <rect
              key={annotation.id}
              x={annotation.rectX}
              y={annotation.rectY}
              width={annotation.rectWidth}
              height={annotation.rectHeight}
              // vector-effect keeps the outline the same visible thickness at
              // any zoom. Without it, a stroke width in unit-square
              // coordinates would be about half the page wide.
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
          ))}

          {draft ? (
            <rect
              x={draft.x}
              y={draft.y}
              width={draft.width}
              height={draft.height}
              vectorEffect="non-scaling-stroke"
              strokeWidth={2}
              strokeDasharray="6 4"
              className="fill-accent/10 stroke-accent"
            />
          ) : null}
        </svg>

        {annotations.filter(isRegionAnnotation).map((annotation, index) => (
          <span
            key={annotation.id}
            aria-hidden
            className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              selectedId === annotation.id
                ? "bg-accent text-paper"
                : "bg-paper-raised text-accent ring-1 ring-accent"
            }`}
            style={{
              left: `${annotation.rectX * 100}%`,
              top: `${annotation.rectY * 100}%`,
            }}
          >
            {index + 1}
          </span>
        ))}
      </div>
    </div>
  );
}
