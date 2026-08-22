import type { NormalizedRect } from "@/features/annotations/annotations.types";

import type { PageCorners } from "./pages.schema";

export type Point = { x: number; y: number };

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

const UNIT_CORNERS: PageCorners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Must match page-processor/app/rectify.py. */
const EDGE_INSET_RATIO = 0.005;
const MIN_RECT_SIZE = 1e-6;

/**
 * Move a rectangle from one flattened version of a photograph into another.
 * Null corners mean that version was the original, unwarped photograph.
 */
export function remapRectBetweenPageCrops(
  rect: NormalizedRect,
  fromCorners: PageCorners | null,
  toCorners: PageCorners,
): NormalizedRect | null {
  const oldPageInPhoto = canonicalPageCorners(fromCorners);
  const newPageInPhoto = canonicalPageCorners(toCorners);
  const oldScanToPhoto = findHomography(UNIT_CORNERS, oldPageInPhoto);
  const photoToNewScan = findHomography(newPageInPhoto, UNIT_CORNERS);

  if (!oldScanToPhoto || !photoToNewScan) return null;

  const projected = rectFromProjectedCorners(rect, (point) =>
    projectPoint(projectPoint(point, oldScanToPhoto), photoToNewScan),
  );

  return projected.width < MIN_RECT_SIZE || projected.height < MIN_RECT_SIZE
    ? null
    : projected;
}

/** Corners of the pixels that actually became the flattened image. */
export function canonicalPageCorners(corners: PageCorners | null): PageCorners {
  if (!corners) return UNIT_CORNERS.map((point) => ({ ...point })) as PageCorners;

  const ordered = orderPageCorners(corners);
  const centre = ordered.reduce(
    (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
    { x: 0, y: 0 },
  );

  return ordered.map((point) => ({
    x: centre.x + (point.x - centre.x) * (1 - EDGE_INSET_RATIO),
    y: centre.y + (point.y - centre.y) * (1 - EDGE_INSET_RATIO),
  })) as PageCorners;
}

export function orderPageCorners(corners: PageCorners): PageCorners {
  const sums = corners.map((point) => point.x + point.y);
  const differences = corners.map((point) => point.x - point.y);
  const at = (index: number) => corners[index] ?? corners[0];

  return [
    at(sums.indexOf(Math.min(...sums))),
    at(differences.indexOf(Math.max(...differences))),
    at(sums.indexOf(Math.max(...sums))),
    at(differences.indexOf(Math.min(...differences))),
  ] as PageCorners;
}

function findHomography(
  from: PageCorners,
  to: PageCorners,
): HomographyMatrix | null {
  const matrix: number[][] = [];

  for (let index = 0; index < 4; index += 1) {
    const source = from[index]!;
    const target = to[index]!;

    matrix.push([
      source.x, source.y, 1, 0, 0, 0,
      -target.x * source.x, -target.x * source.y, target.x,
    ]);
    matrix.push([
      0, 0, 0, source.x, source.y, 1,
      -target.y * source.x, -target.y * source.y, target.y,
    ]);
  }

  const solution = solveLinearSystem(matrix);

  return solution
    ? [
        solution[0]!, solution[1]!, solution[2]!, solution[3]!, solution[4]!,
        solution[5]!, solution[6]!, solution[7]!, 1,
      ]
    : null;
}

function solveLinearSystem(matrix: number[][]): number[] | null {
  const size = matrix.length;

  for (let column = 0; column < size; column += 1) {
    let pivot = column;

    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row]![column]!) > Math.abs(matrix[pivot]![column]!)) {
        pivot = row;
      }
    }

    if (Math.abs(matrix[pivot]![column]!) < 1e-12) return null;
    [matrix[column], matrix[pivot]] = [matrix[pivot]!, matrix[column]!];

    const divisor = matrix[column]![column]!;
    for (let cell = column; cell <= size; cell += 1) {
      matrix[column]![cell] = matrix[column]![cell]! / divisor;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row]![column]!;
      for (let cell = column; cell <= size; cell += 1) {
        matrix[row]![cell] =
          matrix[row]![cell]! - factor * matrix[column]![cell]!;
      }
    }
  }

  return matrix.map((row) => row[size]!);
}

function projectPoint(point: Point, matrix: HomographyMatrix): Point {
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

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
