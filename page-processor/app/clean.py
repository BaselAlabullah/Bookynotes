"""Making a photographed page look like a scanned one.

A phone photograph of paper is unevenly lit almost by definition: a lamp on one
side, the reader's own shadow on the other, and a warm cast from whatever bulb
is in the room. The text is perfectly legible to a human and noticeably harder
for everything else — and it simply looks like a snapshot rather than a page.

Two operations fix most of it, and deliberately no more than two. Anything
stronger starts destroying the thing being preserved.
"""

from __future__ import annotations

import cv2
import numpy as np

# CLAHE tile size. Small tiles chase local detail and start amplifying paper
# grain into visible noise; large ones behave like a global stretch and leave
# the shadow behind. 8x8 over a page is roughly a paragraph per tile.
CLAHE_TILE_GRID = (8, 8)

# The ceiling on local contrast amplification. Above about 3 the print starts
# to bloom and thin serifs break up.
CLAHE_CLIP_LIMIT = 2.5


def normalise_illumination(image: np.ndarray) -> np.ndarray:
    """Even out the lighting without touching the colours.

    Done in LAB rather than RGB, and only to L. LAB separates lightness from
    colour, so brightening a shadowed corner in L leaves its hue alone. Doing
    the same in RGB means stretching three channels independently, which shifts
    the white balance and turns cream paper faintly green.
    """
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lightness, a, b = cv2.split(lab)

    # CLAHE rather than a global histogram stretch: the whole point is that one
    # side of the page is darker than the other, and a global operation cannot
    # by definition treat two regions differently.
    clahe = cv2.createCLAHE(
        clipLimit=CLAHE_CLIP_LIMIT, tileGridSize=CLAHE_TILE_GRID
    )

    return cv2.cvtColor(cv2.merge([clahe.apply(lightness), a, b]), cv2.COLOR_LAB2BGR)


def whiten_paper(image: np.ndarray) -> np.ndarray:
    """Pull the paper back towards white, keeping the ink where it is.

    Flat-field correction: divide the image by a heavily blurred copy of
    itself. The blurred copy is, in effect, a map of the lighting — it has lost
    the text but kept the gradient — so dividing by it removes the gradient and
    leaves the text.

    The blur has to be much wider than a letter, or the letters end up in the
    lighting map and get divided away along with the shadow.
    """
    # About a fifteenth of the page, forced odd as GaussianBlur requires.
    radius = max(image.shape[:2]) // 15
    radius = radius + 1 if radius % 2 == 0 else radius
    radius = max(radius, 3)

    background = cv2.GaussianBlur(image, (radius, radius), 0)

    # +1 on the divisor so a black pixel cannot divide by zero. The result is
    # scaled to 255 so that "as bright as its surroundings" becomes white.
    corrected = cv2.divide(image.astype(np.float32), background.astype(np.float32) + 1.0)

    return np.clip(corrected * 255.0, 0, 255).astype(np.uint8)


def clean(image: np.ndarray) -> np.ndarray:
    """Flat-field first, then even out what is left.

    Note what this does *not* do: it does not binarise. Thresholding a page to
    pure black and white is the classic "scanner" look and it throws away
    information — faint pencil annotations, the grey of a photograph printed on
    the page, the anti-aliasing that makes small type readable. A vision model
    reading the result does better with the greys intact, and so does a person.
    """
    return normalise_illumination(whiten_paper(image))
