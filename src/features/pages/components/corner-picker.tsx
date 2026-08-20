"use client";

import { useRef, useState } from "react";

export type Point = { x: number; y: number };
export type Corners = [Point, Point, Point, Point];

/**
 * Where the handles start: a rectangle inset from the edges of the photograph.
 *
 * Not the exact corners of the image, so that all four are visibly grabbable
 * rather than half-off the edge, and so it is obvious they are meant to be
 * moved.
 */
export const DEFAULT_CORNERS: Corners = [
  { x: 0.08, y: 0.08 },
  { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 },
  { x: 0.08, y: 0.92 },
];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Sort four points into top-left, top-right, bottom-right, bottom-left.
 *
 * The same trick as the Python service, for the same reason and deliberately
 * mirrored: the smallest x + y is the top-left corner, the largest is the
 * bottom-right, and x - y separates the other two.
 *
 * Here it only affects the outline drawn on screen. Drag the handles into a
 * crossed-over order and the polygon would otherwise render as a bowtie, which
 * looks like a bug in something. The server sorts them again anyway, so this is
 * about what the reader sees, not about correctness of the result.
 */
function ordered(corners: Corners): Corners {
  const sums = corners.map((corner) => corner.x + corner.y);
  const diffs = corners.map((corner) => corner.x - corner.y);

  const at = (index: number) => corners[index] ?? corners[0];

  return [
    at(sums.indexOf(Math.min(...sums))),
    at(diffs.indexOf(Math.max(...diffs))),
    at(sums.indexOf(Math.max(...sums))),
    at(diffs.indexOf(Math.min(...diffs))),
  ] as Corners;
}

type CornerPickerProps = {
  imageUrl: string;
  corners: Corners;
  onChange: (corners: Corners) => void;
};

/**
 * Four draggable handles over a photograph, marking where the page is.
 *
 * This exists because automatic detection does not survive contact with real
 * photographs. It needs a flat page with four findable edges against a
 * contrasting background; people photograph books held open, with a curved
 * spine, a thumb across one corner, and cream paper on a white desk. There is
 * often no quadrilateral to find at all.
 *
 * A person looking at the picture has none of those problems.
 *
 * The coordinates are normalized — fractions of the image, never pixels — which
 * is the same discipline the annotation canvas uses and for the same reasons
 * (DECISIONS 0031). Handles are positioned in percentages and the outline is an
 * SVG with a unit-square viewBox, so nothing here measures anything, and the
 * whole thing stays correct at any size the preview happens to be rendered at.
 */
export function CornerPicker({
  imageUrl,
  corners,
  onChange,
}: CornerPickerProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  function pointFromEvent(event: React.PointerEvent): Point | null {
    const surface = surfaceRef.current;

    if (!surface) {
      return null;
    }

    // getBoundingClientRect reports the box as actually painted, so this stays
    // correct whatever size the preview is and however the page is scrolled.
    const box = surface.getBoundingClientRect();

    return {
      x: clamp01((event.clientX - box.left) / box.width),
      y: clamp01((event.clientY - box.top) / box.height),
    };
  }

  function moveCorner(index: number, point: Point) {
    const next = [...corners] as Corners;
    next[index] = point;
    onChange(next);
  }

  const outline = ordered(corners);
  const polygon = outline.map((corner) => `${corner.x},${corner.y}`).join(" ");

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={surfaceRef}
        className="relative mx-auto max-h-[52vh] w-fit touch-none select-none"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="The photograph you are about to upload"
          className="block max-h-[52vh] w-auto"
          draggable={false}
        />

        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {/* Everything outside the quadrilateral, dimmed, so the selection
              reads as "this part is the page" rather than as a floating box. */}
          <defs>
            <mask id="page-area">
              <rect width="1" height="1" fill="white" />
              <polygon points={polygon} fill="black" />
            </mask>
          </defs>
          <rect
            width="1"
            height="1"
            fill="black"
            opacity="0.45"
            mask="url(#page-area)"
          />
          <polygon
            points={polygon}
            fill="none"
            stroke="#e11d48"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {corners.map((corner, index) => (
          <button
            key={index}
            type="button"
            aria-label={`Page corner ${index + 1}`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(index);
            }}
            onPointerMove={(event) => {
              if (dragging !== index) return;
              const point = pointFromEvent(event);
              if (point) moveCorner(index, point);
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              setDragging(null);
            }}
            onPointerCancel={() => setDragging(null)}
            onKeyDown={(event) => {
              // Keyboard nudging, because a drag-only control is unusable
              // without a pointer. One percent a press, ten with shift.
              const step = event.shiftKey ? 0.1 : 0.01;
              const moves: Record<string, Point> = {
                ArrowLeft: { x: -step, y: 0 },
                ArrowRight: { x: step, y: 0 },
                ArrowUp: { x: 0, y: -step },
                ArrowDown: { x: 0, y: step },
              };
              const move = moves[event.key];
              if (!move) return;

              event.preventDefault();
              moveCorner(index, {
                x: clamp01(corner.x + move.x),
                y: clamp01(corner.y + move.y),
              });
            }}
            style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
            className={`absolute size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-paper bg-accent shadow-[0_1px_4px_rgba(0,0,0,0.5)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              dragging === index ? "scale-125 cursor-grabbing" : ""
            }`}
          />
        ))}
      </div>

      <p className="text-center text-xs text-ink-muted">
        Drag each dot to a corner of the page. Arrow keys nudge; hold shift for
        larger steps.
      </p>
    </div>
  );
}
