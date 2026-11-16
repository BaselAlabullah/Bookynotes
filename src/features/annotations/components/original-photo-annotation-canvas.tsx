import { useRef, useState } from "react";

import type { Point, Projection } from "@/features/pages/pages.projection";
import { isRegionAnnotation, type Annotation, type NormalizedRect } from "../annotations.types";

const MIN_SELECTION_SIZE = 0.005;
const ORIGINAL_FIT_HEIGHT_VH = 78;

export function OriginalPhotoAnnotationCanvas({
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
                  className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-xs font-medium ${
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
