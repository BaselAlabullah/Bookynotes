import { describe, expect, test } from "vitest";

import type { PageCorners } from "./pages.schema";
import { remapRectBetweenPageCrops } from "./pages.projection";

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
