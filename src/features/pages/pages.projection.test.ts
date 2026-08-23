import { describe, expect, test } from "vitest";

import type { PageCorners } from "./pages.schema";
import { orderPageCorners, remapRectBetweenPageCrops } from "./pages.projection";

const insetSquare: PageCorners = [
  { x: 0.25, y: 0.25 },
  { x: 0.75, y: 0.25 },
  { x: 0.75, y: 0.75 },
  { x: 0.25, y: 0.75 },
];

describe("remapRectBetweenPageCrops", () => {
  test("keeps a rectangle stable when the saved corners do not change", () => {
    const result = remapRectBetweenPageCrops(
      { x: 0.2, y: 0.4, width: 0.3, height: 0.08 },
      insetSquare,
      insetSquare,
    );

    expect(result).not.toBeNull();
    expect(result?.x).toBeCloseTo(0.2);
    expect(result?.y).toBeCloseTo(0.4);
    expect(result?.width).toBeCloseTo(0.3);
    expect(result?.height).toBeCloseTo(0.08);
  });

  test("maps an annotation on an original photo into a later page crop", () => {
    const result = remapRectBetweenPageCrops(
      { x: 0.3, y: 0.3, width: 0.2, height: 0.1 },
      null,
      insetSquare,
    );

    expect(result).not.toBeNull();
    expect(result?.x).toBeCloseTo(0.1, 1);
    expect(result?.y).toBeCloseTo(0.1, 1);
    expect(result?.width).toBeCloseTo(0.4, 1);
    expect(result?.height).toBeCloseTo(0.2, 1);
  });

  test("refuses a crop that would remove an existing annotation", () => {
    expect(
      remapRectBetweenPageCrops(
        { x: 0.02, y: 0.02, width: 0.04, height: 0.04 },
        null,
        insetSquare,
      ),
    ).toBeNull();
  });
});

const diamond: PageCorners = [
  { x: 0.5, y: 0.0 },
  { x: 1.0, y: 0.5 },
  { x: 0.5, y: 1.0 },
  { x: 0.0, y: 0.5 },
];

const distinct = (corners: PageCorners) =>
  new Set(corners.map((point) => `${point.x},${point.y}`)).size;

describe("orderPageCorners", () => {
  test("returns each corner exactly once on a diamond", () => {
    // Regression. The previous heuristic picked corners by extremes of x + y
    // and x - y. Two corners of a diamond tie on both, so `indexOf` returned
    // the same index twice: one corner was duplicated and another dropped,
    // which made the homography singular and refused the save with a message
    // blaming the annotations.
    expect(distinct(orderPageCorners(diamond))).toBe(4);
  });

  test("does not depend on the order the corners arrive in", () => {
    // The picker hands over whatever order the handles were dragged in, and
    // OpenCV hands over whatever order it walked the outline.
    const rotated: PageCorners = [
      diamond[1],
      diamond[2],
      diamond[3],
      diamond[0],
    ];

    expect(orderPageCorners(rotated)).toEqual(orderPageCorners(diamond));
  });

  test("puts a plain rectangle in top-left, top-right, bottom-right, bottom-left order", () => {
    expect(orderPageCorners(insetSquare)).toEqual(insetSquare);
  });

  test("orders a rotated square without duplicating a corner", () => {
    const rotatedSquare: PageCorners = [
      { x: 0.3, y: 0.0 },
      { x: 1.0, y: 0.3 },
      { x: 0.7, y: 1.0 },
      { x: 0.0, y: 0.7 },
    ];

    expect(distinct(orderPageCorners(rotatedSquare))).toBe(4);
    expect(orderPageCorners(rotatedSquare)[0]).toEqual({ x: 0.3, y: 0.0 });
  });
});

describe("remapRectBetweenPageCrops on a diamond", () => {
  test("projects rather than refusing", () => {
    // Before the ordering fix this returned null, because the singular
    // homography could not be solved at all.
    const result = remapRectBetweenPageCrops(
      { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
      null,
      diamond,
    );

    expect(result).not.toBeNull();
    expect(result!.width).toBeGreaterThan(0);
    expect(result!.height).toBeGreaterThan(0);
  });
});
