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

/**
 * Sort four corners into top-left, top-right, bottom-right, bottom-left.
 *
 * The obvious heuristic — smallest `x + y` is top-left, largest is
 * bottom-right, and `x - y` separates the other two — is what this used to do,
 * and it is wrong on any quadrilateral where two corners tie on one of those
 * tests. A diamond is the clean example: two corners share the minimum sum,
 * `indexOf` returns the same index twice, one corner is dropped and another
 * appears twice. The homography built from that is singular, so a corner save
 * was refused with a message blaming the annotations.
 *
 * Sorting by angle around the centroid cannot produce a duplicate, because it
 * is a permutation of the input. Angles increase clockwise on screen — y grows
 * downward — so ascending order already walks top-left, top-right,
 * bottom-right, bottom-left; only the starting phase is unknown, and rotating
 * the cycle to begin at the corner nearest the origin fixes that.
 *
 * Which corner deserves to be called "top-left" on a diamond is genuinely
 * ambiguous. The requirement is not to resolve that but to be deterministic
 * and to agree with `order_corners` in page-processor/app/rectify.py, since
 * one orders the pixels and the other orders the coordinates projected onto
 * them. The two must stay identical.
 */
export function orderPageCorners(corners: PageCorners): PageCorners {
  const centre = corners.reduce(
    (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
    { x: 0, y: 0 },
  );
  const clockwise = [...corners].sort(
    (a, b) =>
      Math.atan2(a.y - centre.y, a.x - centre.x) -
      Math.atan2(b.y - centre.y, b.x - centre.x),
  );

  let start = 0;

  for (let index = 1; index < 4; index += 1) {
    if (isNearerOrigin(clockwise[index]!, clockwise[start]!)) start = index;
  }

  return [0, 1, 2, 3].map(
    (offset) => clockwise[(start + offset) % 4]!,
  ) as PageCorners;
}

/**
 * Which of two corners is the better top-left. `x + y` decides it; the
 * remaining comparisons exist only so that a tie resolves the same way here
 * and in Python rather than by whichever order the points arrived in.
 */
function isNearerOrigin(candidate: Point, best: Point): boolean {
  const candidateSum = candidate.x + candidate.y;
  const bestSum = best.x + best.y;

  if (candidateSum !== bestSum) return candidateSum < bestSum;
  if (candidate.x !== best.x) return candidate.x < best.x;

  return candidate.y < best.y;
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
