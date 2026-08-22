"""The page-processor service.

One endpoint. An image goes in and a perspective-corrected version comes out.

It holds no user data, has no database, and makes no authorization decisions —
the Next app has already established who owns the page before it calls here.
That narrowness is deliberate: it is what makes running this on a laptop while
the rest of the app is deployed a reasonable thing to do rather than a hole.
"""

from __future__ import annotations

import json

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response

from .config import API_KEY, MAX_UPLOAD_BYTES, OUTPUT_QUALITY
from .rectify import InvalidCorners, rectify, rectify_with_corners

app = FastAPI(
    title="Bookynotes page-processor",
    description="Flattens photographs of book pages while preserving their colours.",
    version="0.1.0",
)


@app.get("/health")
def health() -> JSONResponse:
    """Liveness, so the Next app can tell 'not configured' from 'not running'."""
    return JSONResponse({"status": "ok"})


def _require_api_key(provided: str | None) -> None:
    # Compared with a constant-time function. The comparison is not really the
    # weak point here, but a timing-safe check costs nothing and means the habit
    # is right when it does matter.
    import hmac

    if not provided or not hmac.compare_digest(provided, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key.")


@app.post("/rectify")
async def rectify_page(
    file: UploadFile = File(...),
    corners: str | None = Form(default=None),
    x_api_key: str | None = Header(default=None),
) -> Response:
    """Flatten a photographed page.

    `corners`, when given, is a JSON array of four [x, y] pairs in 0..1 marking
    the page in the uploaded image — normally placed by the reader by dragging
    handles over a preview. Detection is then skipped entirely.

    That is not a fallback for when detection fails; it is the better path for
    the photographs people actually take. A book held open has a curved spine,
    a thumb over one corner and a page the same colour as the desk. There is no
    quadrilateral to find. Somebody looking at the picture, however, can place
    four points in a couple of seconds.

    The response body is the resulting JPEG. The metadata rides in headers
    rather than wrapping the image in JSON, because base64 would inflate a
    multi-megabyte photograph by a third for no gain:

        X-Rectified   whether a page outline was found at all
        X-Confidence  0.0 to 1.0; 0.0 means the original is being returned
        X-Corners     the detected corners in the input image, when found
        X-Width       dimensions of the returned image, so the caller need not
        X-Height      decode it to learn them

    A photograph this service cannot make sense of comes back unchanged with a
    confidence of 0. That is a successful response, not an error: the caller
    stores what it got and the page is still perfectly usable.
    """
    _require_api_key(x_api_key)

    payload = await file.read()

    if not payload:
        raise HTTPException(status_code=400, detail="Empty upload.")

    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image is larger than {MAX_UPLOAD_BYTES} bytes.",
        )

    image = cv2.imdecode(np.frombuffer(payload, np.uint8), cv2.IMREAD_COLOR)

    if image is None:
        # imdecode returns None rather than raising. Whatever arrived was not an
        # image OpenCV can read, and that is the caller's problem to hear about.
        raise HTTPException(status_code=415, detail="Not a decodable image.")

    if corners is None:
        result = rectify(image)
    else:
        try:
            result = rectify_with_corners(image, json.loads(corners))
        except json.JSONDecodeError as error:
            raise HTTPException(
                status_code=400, detail="corners is not valid JSON."
            ) from error
        except InvalidCorners as error:
            # A 400 rather than a silent fallback: the reader placed these, so
            # quietly ignoring them and returning something else would be
            # baffling. The caller can say what went wrong.
            raise HTTPException(status_code=400, detail=str(error)) from error

    encoded, buffer = cv2.imencode(
        ".jpg", result.image, [int(cv2.IMWRITE_JPEG_QUALITY), OUTPUT_QUALITY]
    )

    if not encoded:
        raise HTTPException(status_code=500, detail="Could not encode the result.")

    height, width = result.image.shape[:2]

    headers = {
        "X-Rectified": "true" if result.rectified else "false",
        "X-Source": "manual" if corners is not None else "detected",
        "X-Confidence": f"{result.confidence:.3f}",
        "X-Width": str(width),
        "X-Height": str(height),
    }

    if result.corners is not None:
        headers["X-Corners"] = json.dumps(
            [[round(x, 1), round(y, 1)] for x, y in result.corners]
        )

    return Response(
        content=buffer.tobytes(), media_type="image/jpeg", headers=headers
    )
