"""Tests for the page flattener.

The approach: build a flat page, warp it by a *known* perspective transform,
and check that rectifying it undoes the warp. Because the ground truth is
constructed rather than guessed at, the assertions can be about numbers —
aspect ratio, corner positions — instead of "it looks better".

Run from the page-processor directory:

    .venv/Scripts/python.exe -m tests.test_rectify
"""

from __future__ import annotations

import sys

import cv2
import numpy as np

from app.rectify import (
    InvalidCorners,
    find_page_quad,
    order_corners,
    rectify,
    rectify_with_corners,
)

PAGE_WIDTH = 1200
PAGE_HEIGHT = 1700


def build_flat_page() -> np.ndarray:
    """A page of text on cream paper, perfectly square on."""
    page = np.full((PAGE_HEIGHT, PAGE_WIDTH, 3), (222, 236, 248), dtype=np.uint8)

    for index in range(30):
        y = 160 + index * 50
        length = PAGE_WIDTH - 240 - (index % 4) * 90
        cv2.putText(
            page,
            "the cartographer had never seen the sea and drew it from rumour",
            (120, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (40, 34, 28),
            1,
            cv2.LINE_AA,
        )
        cv2.line(page, (120, y + 8), (120 + length // 2, y + 8), (240, 248, 252), 1)

    return page


def photograph(page: np.ndarray, tilt: float = 0.14) -> tuple[np.ndarray, np.ndarray]:
    """Simulate photographing the page at an angle on a dark desk.

    Returns the photograph and the true corner positions within it, so the
    detector can be graded against them.
    """
    margin = 180
    height, width = page.shape[:2]
    canvas_w, canvas_h = width + margin * 2, height + margin * 2

    # A trapezoid: the top edge recedes, which is what holding a camera above a
    # book actually does.
    inset = int(width * tilt)
    corners = np.array(
        [
            [margin + inset, margin],
            [margin + width - inset, margin],
            [margin + width, margin + height],
            [margin, margin + height],
        ],
        dtype="float32",
    )

    source = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype="float32",
    )

    transform = cv2.getPerspectiveTransform(source, corners)

    # A desk that is clearly darker than the paper, so there is a real edge to
    # find rather than white-on-white.
    canvas = np.full((canvas_h, canvas_w, 3), (70, 62, 55), dtype=np.uint8)
    warped = cv2.warpPerspective(page, transform, (canvas_w, canvas_h))
    mask = cv2.warpPerspective(
        np.full((height, width), 255, np.uint8), transform, (canvas_w, canvas_h)
    )
    canvas[mask > 0] = warped[mask > 0]

    # Uneven lighting: bright at one corner, falling away across the frame.
    gradient_y = np.linspace(1.25, 0.62, canvas_h, dtype=np.float32)
    gradient_x = np.linspace(1.18, 0.75, canvas_w, dtype=np.float32)
    lighting = np.outer(gradient_y, gradient_x)[:, :, None]

    lit = np.clip(canvas.astype(np.float32) * lighting, 0, 255).astype(np.uint8)

    return lit, corners


def test_order_corners_is_orientation_independent() -> None:
    """However the corners arrive, they come out in the same order."""
    canonical = np.array(
        [[10, 10], [110, 12], [108, 210], [8, 208]], dtype="float32"
    )

    for roll in range(4):
        rotated = np.roll(canonical, roll, axis=0)
        assert np.allclose(order_corners(rotated), canonical, atol=1.0), (
            f"rolling the input by {roll} changed the ordering"
        )

    reversed_order = canonical[::-1]
    assert np.allclose(order_corners(reversed_order), canonical, atol=1.0)


def test_finds_the_page_corners() -> None:
    photo, truth = photograph(build_flat_page())
    found = find_page_quad(photo)

    assert found is not None, "no page outline found in a clean synthetic photo"

    quad, confidence = found
    error = np.linalg.norm(quad - truth, axis=1).max()
    longest_side = max(photo.shape[:2])

    assert error < longest_side * 0.02, (
        f"corner error {error:.1f}px exceeds 2% of {longest_side}px"
    )
    assert confidence > 0.3, f"confidence {confidence:.2f} unexpectedly low"


def test_rectified_page_has_the_original_aspect_ratio() -> None:
    """The real check: undoing the warp restores the page's proportions."""
    photo, _ = photograph(build_flat_page())
    result = rectify(photo)

    assert result.rectified, "rectify fell back to the original"

    height, width = result.image.shape[:2]
    restored = width / height
    expected = PAGE_WIDTH / PAGE_HEIGHT

    assert abs(restored - expected) / expected < 0.05, (
        f"aspect ratio {restored:.3f} is not within 5% of {expected:.3f}"
    )


def test_a_photo_with_no_page_is_returned_untouched() -> None:
    """Failing to find a page must be survivable, not an exception."""
    noise = np.random.default_rng(0).integers(
        0, 255, (900, 700, 3), dtype=np.uint8
    )
    result = rectify(noise)

    assert not result.rectified
    assert result.confidence == 0.0
    assert result.image is noise, "the original should be handed straight back"


def test_manual_corners_flatten_a_page_detection_would_miss() -> None:
    """The case the whole feature exists for.

    Detection needs four findable edges. Here the page is deliberately given a
    background it cannot be told apart from, so `rectify` gives up — and the
    same image, with corners supplied, comes out flattened.
    """
    page = build_flat_page()
    photo, truth = photograph(page)

    # Repaint the desk the same colour as the paper, so there is no edge left.
    grey = cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY)
    photo[grey < 110] = (222, 236, 248)

    assert not rectify(photo).rectified, (
        "detection should fail on a page with no distinguishable border"
    )

    height, width = photo.shape[:2]
    normalised = [[float(x) / width, float(y) / height] for x, y in truth]
    result = rectify_with_corners(photo, normalised)

    assert result.rectified
    assert result.confidence == 1.0

    restored = result.image.shape[1] / result.image.shape[0]
    expected = PAGE_WIDTH / PAGE_HEIGHT
    assert abs(restored - expected) / expected < 0.05, (
        f"aspect ratio {restored:.3f} is not within 5% of {expected:.3f}"
    )


def test_manual_corners_may_arrive_in_any_order() -> None:
    """Dragging handles produces whatever order the user touched them in."""
    photo, truth = photograph(build_flat_page())
    height, width = photo.shape[:2]
    normalised = [[float(x) / width, float(y) / height] for x, y in truth]

    baseline = rectify_with_corners(photo, normalised).image.shape

    for roll in range(1, 4):
        rolled = normalised[roll:] + normalised[:roll]
        assert rectify_with_corners(photo, rolled).image.shape == baseline, (
            f"rotating the corner list by {roll} changed the result"
        )


def test_bad_corners_are_refused_rather_than_guessed_at() -> None:
    photo, _ = photograph(build_flat_page())

    for label, corners in [
        ("too few", [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9]]),
        ("out of range", [[0.1, 0.1], [1.4, 0.1], [0.9, 0.9], [0.1, 0.9]]),
        ("negative", [[-0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]),
        ("not a pair", [[0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]),
        ("a tap, not a drag", [[0.5, 0.5], [0.51, 0.5], [0.51, 0.51], [0.5, 0.51]]),
    ]:
        try:
            rectify_with_corners(photo, corners)
        except InvalidCorners:
            continue
        raise AssertionError(f"{label}: should have been refused")


def test_order_corners_returns_each_corner_once_on_a_diamond() -> None:
    """Regression: extremes of x + y and x - y tie on a diamond.

    `argmin` then returned the same index twice, duplicating one corner and
    dropping another, which made the warp degenerate.
    """
    diamond = np.array(
        [[0.5, 0.0], [1.0, 0.5], [0.5, 1.0], [0.0, 0.5]], dtype="float32"
    )

    ordered = order_corners(diamond)

    assert len({(float(p[0]), float(p[1])) for p in ordered}) == 4


def test_order_corners_ignores_the_order_the_points_arrive_in() -> None:
    quad = np.array(
        [[0.1, 0.1], [0.9, 0.12], [0.88, 0.9], [0.12, 0.88]], dtype="float32"
    )

    for shift in range(4):
        assert np.allclose(order_corners(np.roll(quad, shift, axis=0)), order_corners(quad))


def test_order_corners_matches_the_typescript_ordering() -> None:
    """The two implementations must agree.

    This one orders the pixels; `orderPageCorners` in
    src/features/pages/pages.projection.ts orders the annotation coordinates
    projected onto them. If they disagree about a quadrilateral, notes land
    somewhere the reader did not put them.
    """
    quads = [
        [[0.05, 0.04], [0.95, 0.05], [0.96, 0.95], [0.04, 0.94]],
        [[0.5, 0.0], [1.0, 0.5], [0.5, 1.0], [0.0, 0.5]],
        [[0.3, 0.0], [1.0, 0.3], [0.7, 1.0], [0.0, 0.7]],
        [[0.2, 0.1], [0.8, 0.1], [0.9, 0.9], [0.1, 0.9]],
    ]
    # Produced by orderPageCorners for exactly these inputs.
    expected = [
        [[0.05, 0.04], [0.95, 0.05], [0.96, 0.95], [0.04, 0.94]],
        [[0.0, 0.5], [0.5, 0.0], [1.0, 0.5], [0.5, 1.0]],
        [[0.3, 0.0], [1.0, 0.3], [0.7, 1.0], [0.0, 0.7]],
        [[0.2, 0.1], [0.8, 0.1], [0.9, 0.9], [0.1, 0.9]],
    ]

    for quad, want in zip(quads, expected):
        assert np.allclose(
            order_corners(np.array(quad, dtype="float32")),
            np.array(want, dtype="float32"),
        )


def main() -> int:
    tests = [value for name, value in globals().items() if name.startswith("test_")]
    failures = 0

    for test in tests:
        try:
            test()
            print(f"  PASS  {test.__name__}")
        except AssertionError as error:
            failures += 1
            print(f"  FAIL  {test.__name__}\n        {error}")

    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
