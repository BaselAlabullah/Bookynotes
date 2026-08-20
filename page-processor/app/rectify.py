"""Finding a page in a photograph and flattening it.

The problem this solves is not blur or noise. It is that a photograph of a book
is a picture of a *quadrilateral* — the page recedes, the spine curves, the
camera is never quite square on. Every straight line in the print arrives
slanted.

The approach is the classic one and it is worth stating plainly, because the
whole file is four steps:

1. Find the strongest four-sided outline in the image. That is the page.
2. Put its corners in a known order.
3. Work out how big the flattened page should be, from the lengths of its own
   edges.
4. Warp it to that rectangle.

Everything else here is guarding against step 1 finding something that is not a
page — a table edge, a shadow, the whole frame — because a confident wrong
answer is far worse than admitting defeat and returning the original.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

# Detection runs on a downscaled copy. Edges are a shape property, not a
# resolution one, and working at 1500px instead of 4000px is several times
# faster for an identical result. The corners are scaled back up before the
# warp, so the output is still full resolution.
DETECTION_MAX_SIDE = 1500

# A page fills most of a photograph someone took *of a page*. Anything smaller
# is much more likely to be a book cover lying on a desk, or a shadow.
MIN_AREA_RATIO = 0.20

# Above this, the "quadrilateral" is essentially the whole frame — which is what
# you get when the edge detector latches onto the image border rather than the
# paper. That is not a detection, it is a tautology.
MAX_AREA_RATIO = 0.995

# A page photographed from a sane angle stays roughly convex and roughly
# rectangular. This is the loosest useful check: no corner may be crushed below
# 45 degrees or splayed past 135.
MIN_CORNER_ANGLE = 45.0
MAX_CORNER_ANGLE = 135.0

# Pull the detected quadrilateral very slightly inwards before warping.
#
# The edge detector finds the boundary *between* page and desk, so the outermost
# row of pixels it hands back is part desk. Warped, that becomes a thin dark
# frame around every page. Half a percent is under a pixel of real text on any
# realistic photograph and removes the frame entirely.
EDGE_INSET_RATIO = 0.005


@dataclass(frozen=True)
class RectifyResult:
    """What came out, and how much to believe it."""

    image: np.ndarray
    #: 0.0 when nothing was found and the original is being returned unchanged.
    confidence: float
    #: Page corners in the *original* image, clockwise from top-left, or None.
    corners: list[list[float]] | None

    @property
    def rectified(self) -> bool:
        return self.corners is not None


def order_corners(points: np.ndarray) -> np.ndarray:
    """Sort four points into top-left, top-right, bottom-right, bottom-left.

    `findContours` returns them in whatever order it walked the outline, which
    depends on where it started. Warping with unordered corners produces an
    image that is rotated or mirrored — it looks like a bug in the transform,
    and it is really a bug here.

    The trick: for the top-left corner, x + y is smallest; for bottom-right it
    is largest. For the other two, x - y separates them. It relies on nothing
    but the coordinates themselves.
    """
    points = points.reshape(4, 2).astype("float32")
    ordered = np.zeros((4, 2), dtype="float32")

    coordinate_sum = points.sum(axis=1)
    ordered[0] = points[np.argmin(coordinate_sum)]  # top-left
    ordered[2] = points[np.argmax(coordinate_sum)]  # bottom-right

    coordinate_diff = np.diff(points, axis=1)
    ordered[1] = points[np.argmin(coordinate_diff)]  # top-right
    ordered[3] = points[np.argmax(coordinate_diff)]  # bottom-left

    return ordered


def _corner_angles(quad: np.ndarray) -> list[float]:
    """The four interior angles, in degrees."""
    angles = []

    for index in range(4):
        previous = quad[(index - 1) % 4]
        current = quad[index]
        following = quad[(index + 1) % 4]

        a = previous - current
        b = following - current
        cosine = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)
        angles.append(float(np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0)))))

    return angles


def _looks_like_a_page(quad: np.ndarray, image_area: float) -> bool:
    area = cv2.contourArea(quad)

    if not (MIN_AREA_RATIO <= area / image_area <= MAX_AREA_RATIO):
        return False

    if not cv2.isContourConvex(quad.astype("int32")):
        return False

    return all(
        MIN_CORNER_ANGLE <= angle <= MAX_CORNER_ANGLE
        for angle in _corner_angles(quad)
    )


def find_page_quad(image: np.ndarray) -> tuple[np.ndarray, float] | None:
    """The page outline in full-resolution coordinates, and a confidence.

    Returns None when nothing convincing is found, which is a normal outcome
    and the reason the caller can always fall back to the original.
    """
    height, width = image.shape[:2]
    scale = min(1.0, DETECTION_MAX_SIDE / max(height, width))
    small = (
        cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        if scale < 1.0
        else image
    )

    grey = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

    # Bilateral rather than Gaussian: it flattens paper grain and print without
    # softening the one thing being looked for, which is the page edge.
    smoothed = cv2.bilateralFilter(grey, d=9, sigmaColor=75, sigmaSpace=75)

    # Canny's thresholds are derived from the image's own median instead of
    # being hard-coded, so a dim photo and a bright one behave the same way.
    median = float(np.median(smoothed))
    lower = int(max(0, 0.66 * median))
    upper = int(min(255, 1.33 * median))
    edges = cv2.Canny(smoothed, lower, upper)

    # Paper edges break up where the page meets a similar background. Dilating
    # closes those gaps so the outline is a single contour rather than four
    # disconnected sides.
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=1)

    contours, _ = cv2.findContours(
        edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    small_area = float(small.shape[0] * small.shape[1])

    # Largest first: the page is the biggest thing in a photograph of a page.
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
        perimeter = cv2.arcLength(contour, closed=True)
        # 2% of the perimeter is the usual tolerance for "simplify this outline
        # until it is a polygon". Too small and paper texture survives as extra
        # vertices; too large and a genuine corner gets rounded away.
        approximation = cv2.approxPolyDP(contour, 0.02 * perimeter, closed=True)

        if len(approximation) != 4:
            continue

        quad = order_corners(approximation)

        if not _looks_like_a_page(quad, small_area):
            continue

        # How much of the frame the page fills. A page that fills the frame was
        # unambiguous to find; one that fills a fifth of it might be something
        # else entirely, and the caller can decide what to do with that.
        coverage = cv2.contourArea(quad) / small_area
        confidence = float(np.clip((coverage - MIN_AREA_RATIO) / 0.6, 0.0, 1.0))

        return quad / scale, confidence

    return None


def inset_quad(quad: np.ndarray, ratio: float = EDGE_INSET_RATIO) -> np.ndarray:
    """Move each corner slightly towards the centre of the quadrilateral."""
    centre = quad.mean(axis=0)

    return (quad - centre) * (1.0 - ratio) + centre


def warp_to_rectangle(image: np.ndarray, quad: np.ndarray) -> np.ndarray:
    """Flatten the quadrilateral into a rectangle.

    The output size comes from the page's own edges rather than from a fixed
    aspect ratio: the longer of the two horizontal edges becomes the width, the
    longer of the two vertical edges the height. Using the *longer* of each pair
    matters — the near edge of a tilted page is longer than the far one, and
    picking the far one would squash the result.
    """
    quad = inset_quad(quad)
    top_left, top_right, bottom_right, bottom_left = quad

    width = int(
        max(
            np.linalg.norm(bottom_right - bottom_left),
            np.linalg.norm(top_right - top_left),
        )
    )
    height = int(
        max(
            np.linalg.norm(top_right - bottom_right),
            np.linalg.norm(top_left - bottom_left),
        )
    )

    width = max(width, 1)
    height = max(height, 1)

    destination = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype="float32",
    )

    transform = cv2.getPerspectiveTransform(quad.astype("float32"), destination)

    return cv2.warpPerspective(
        image, transform, (width, height), flags=cv2.INTER_CUBIC
    )


def rectify(image: np.ndarray) -> RectifyResult:
    """Flatten the page, or return the original untouched.

    Returning the original is a first-class outcome, not an error. A photograph
    taken square-on needs no correction, and a cluttered desk may defeat the
    detector entirely — in both cases the honest answer is the picture that
    came in, with a confidence of zero to say so.
    """
    found = find_page_quad(image)

    if found is None:
        return RectifyResult(image=image, confidence=0.0, corners=None)

    quad, confidence = found

    return RectifyResult(
        image=warp_to_rectangle(image, quad),
        confidence=confidence,
        corners=quad.tolist(),
    )

# A manually placed quadrilateral still has to enclose something. Below this the
# user has almost certainly tapped rather than dragged, and warping it would
# produce an image of four pixels.
MIN_MANUAL_AREA_RATIO = 0.01


class InvalidCorners(ValueError):
    """The four points given cannot describe a page."""


def rectify_with_corners(
    image: np.ndarray, corners: list[list[float]]
) -> RectifyResult:
    """Flatten using corners the reader placed by hand.

    No detection at all, which is the entire point. Automatic detection assumes
    a flat page with four findable edges on a contrasting background; a book
    held open has a curved spine, an occluded corner and a page the same colour
    as the desk. Rather than guess harder, this lets the person holding the book
    say where the page is — and a person is a much better page detector than a
    contour finder.

    Corners arrive normalized, as fractions of the image, in the same 0..1 space
    every annotation coordinate uses. They may be given in any order; they are
    sorted here.
    """
    if len(corners) != 4:
        raise InvalidCorners(f"Expected 4 corners, got {len(corners)}.")

    for point in corners:
        if len(point) != 2 or not all(0.0 <= value <= 1.0 for value in point):
            raise InvalidCorners("Every corner must be an [x, y] pair within 0..1.")

    height, width = image.shape[:2]
    quad = order_corners(
        np.array([[x * width, y * height] for x, y in corners], dtype="float32")
    )

    area = cv2.contourArea(quad)

    if area < MIN_MANUAL_AREA_RATIO * width * height:
        raise InvalidCorners("Those corners enclose almost nothing.")

    return RectifyResult(
        image=warp_to_rectangle(image, quad),
        # Not a measurement. The reader placed these, so there is nothing to be
        # uncertain about — and the caller uses this only to tell "flattened"
        # from "left alone".
        confidence=1.0,
        corners=quad.tolist(),
    )
