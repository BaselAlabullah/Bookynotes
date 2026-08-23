"""The page-processor service.

One endpoint. Storage keys go in and rectified page metadata comes out.

It holds no user data, has no database, and makes no authorization decisions:
the Next app has already established who owns the page before it calls here.
That narrowness is deliberate.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from .config import API_KEY
from .storage_rectify import ProcessorHTTPError, rectify_storage_object

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
    payload: dict[str, Any],
    x_api_key: str | None = Header(default=None),
) -> JSONResponse:
    """Flatten a photographed page.

    The request contains a source object key, a destination object key, and
    optional corners. The service downloads the source from Supabase Storage,
    runs the shared rectifier, uploads a JPEG to the destination, and responds
    only with metadata:

        rectified   whether a page outline was found at all
        confidence  0.0 to 1.0; 0.0 means the original was re-encoded
        corners     the detected corners in the input image, when found
        source      "manual" when corners were supplied, else "detected"
        width       dimensions of the written image, so the caller need not
        height      decode it to learn them

    Bad manual corners are refused with a 400 rather than silently ignored. The
    reader placed them, so substituting something else would be baffling.
    """
    _require_api_key(x_api_key)

    try:
        result = rectify_storage_object(payload)
    except ProcessorHTTPError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error

    return JSONResponse(result.as_json())
