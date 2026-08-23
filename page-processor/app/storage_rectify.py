"""Storage-key based page rectification.

The HTTP adapters are intentionally thin. This module owns the contract shared
by local FastAPI and the Vercel Python function:

    source object key -> decoded image -> shared rectifier -> destination key

The rectification algorithm itself remains in ``rectify.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import cv2
import numpy as np

from .config import (
    MAX_UPLOAD_BYTES,
    OUTPUT_QUALITY,
    SUPABASE_SECRET_KEY,
    SUPABASE_STORAGE_BUCKET,
    SUPABASE_URL,
)
from .rectify import InvalidCorners, RectifyResult, rectify, rectify_with_corners

RAW_KEY = re.compile(
    r"^(?P<user>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
    r"(?P<book>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
    r"(?P<object>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
    r"\.(?P<ext>jpg|png|webp)$"
)
DESTINATION_KEY = re.compile(
    r"^(?P<user>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
    r"(?P<book>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
    r"(?P<object>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
    r"\.flat(?:\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.jpg$"
)


class ProcessorHTTPError(RuntimeError):
    """An expected request failure with an HTTP status."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class StorageObjectNotFound(RuntimeError):
    pass


class StorageClient(Protocol):
    def download(self, storage_key: str) -> bytes:
        ...

    def upload_jpeg(self, storage_key: str, payload: bytes) -> None:
        ...


@dataclass(frozen=True)
class RectifyStorageRequest:
    source_key: str
    destination_key: str
    corners: list[list[float]] | None


@dataclass(frozen=True)
class RectifyStorageResponse:
    rectified: bool
    confidence: float
    width: int
    height: int
    corners: list[list[float]] | None
    source: str

    def as_json(self) -> dict[str, Any]:
        return {
            "rectified": self.rectified,
            "confidence": self.confidence,
            "width": self.width,
            "height": self.height,
            "corners": self.corners,
            "source": self.source,
        }


class SupabaseStorageClient:
    def __init__(self) -> None:
        self._base_url = f"{SUPABASE_URL}/storage/v1"
        self._bucket = SUPABASE_STORAGE_BUCKET
        self._headers = {
            "apikey": SUPABASE_SECRET_KEY,
            "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
        }

    def download(self, storage_key: str) -> bytes:
        request = Request(
            self._object_url(storage_key),
            headers=self._headers,
            method="GET",
        )

        try:
            with urlopen(request, timeout=30) as response:
                return response.read(MAX_UPLOAD_BYTES + 1)
        except HTTPError as error:
            if error.code in (400, 404):
                raise StorageObjectNotFound(storage_key) from error
            raise ProcessorHTTPError(502, "Could not read the source object.") from error
        except URLError as error:
            raise ProcessorHTTPError(502, "Could not reach Supabase Storage.") from error

    def upload_jpeg(self, storage_key: str, payload: bytes) -> None:
        headers = {
            **self._headers,
            "Content-Type": "image/jpeg",
            "Cache-Control": "max-age=3600",
            "x-upsert": "true",
        }
        request = Request(
            self._object_url(storage_key),
            data=payload,
            headers=headers,
            method="POST",
        )

        try:
            with urlopen(request, timeout=30):
                return
        except HTTPError as error:
            raise ProcessorHTTPError(502, "Could not store the rectified object.") from error
        except URLError as error:
            raise ProcessorHTTPError(502, "Could not reach Supabase Storage.") from error

    def _object_url(self, storage_key: str) -> str:
        path = "/".join(quote(part, safe="") for part in storage_key.split("/"))
        return f"{self._base_url}/object/{quote(self._bucket, safe='')}/{path}"


def parse_rectify_storage_request(payload: Any) -> RectifyStorageRequest:
    if not isinstance(payload, dict):
        raise ProcessorHTTPError(400, "Request body must be a JSON object.")

    source_key = payload.get("sourceKey")
    destination_key = payload.get("destinationKey")

    if not isinstance(source_key, str) or not source_key:
        raise ProcessorHTTPError(400, "sourceKey is required.")

    if not isinstance(destination_key, str) or not destination_key:
        raise ProcessorHTTPError(400, "destinationKey is required.")

    corners = payload.get("corners")

    if corners is not None:
        corners = _parse_corners(corners)

    request = RectifyStorageRequest(
        source_key=source_key,
        destination_key=destination_key,
        corners=corners,
    )
    _validate_key_pair(request)

    return request


def rectify_storage_object(
    payload: Any,
    storage: StorageClient | None = None,
) -> RectifyStorageResponse:
    request = parse_rectify_storage_request(payload)
    storage = storage or SupabaseStorageClient()

    try:
        image_payload = storage.download(request.source_key)
    except StorageObjectNotFound as error:
        raise ProcessorHTTPError(404, "Source object not found.") from error

    if not image_payload:
        raise ProcessorHTTPError(400, "Source object is empty.")

    if len(image_payload) > MAX_UPLOAD_BYTES:
        raise ProcessorHTTPError(
            413,
            f"Image is larger than {MAX_UPLOAD_BYTES} bytes.",
        )

    image = cv2.imdecode(np.frombuffer(image_payload, np.uint8), cv2.IMREAD_COLOR)

    if image is None:
        raise ProcessorHTTPError(415, "Source object is not a decodable image.")

    try:
        result = (
            rectify(image)
            if request.corners is None
            else rectify_with_corners(image, request.corners)
        )
    except InvalidCorners as error:
        raise ProcessorHTTPError(400, str(error)) from error

    encoded = _encode_result(result)
    storage.upload_jpeg(request.destination_key, encoded)

    height, width = result.image.shape[:2]

    return RectifyStorageResponse(
        rectified=result.rectified,
        confidence=result.confidence,
        width=width,
        height=height,
        corners=(
            [[round(x, 1), round(y, 1)] for x, y in result.corners]
            if result.corners is not None
            else None
        ),
        source="manual" if request.corners is not None else "detected",
    )


def rectify_storage_json_body(
    body: bytes,
    storage: StorageClient | None = None,
) -> RectifyStorageResponse:
    if not body:
        raise ProcessorHTTPError(400, "Request body is empty.")

    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProcessorHTTPError(400, "Request body is not valid JSON.") from error

    return rectify_storage_object(payload, storage)


def _parse_corners(value: Any) -> list[list[float]]:
    if not isinstance(value, list):
        raise ProcessorHTTPError(400, "corners must be null or an array.")

    corners: list[list[float]] = []

    for point in value:
        if (
            not isinstance(point, list)
            or len(point) != 2
            or not all(isinstance(coordinate, (int, float)) for coordinate in point)
        ):
            raise ProcessorHTTPError(
                400,
                "Every corner must be an [x, y] pair within 0..1.",
            )

        corners.append([float(point[0]), float(point[1])])

    return corners


def _validate_key_pair(request: RectifyStorageRequest) -> None:
    source = RAW_KEY.fullmatch(request.source_key)

    if not source:
        raise ProcessorHTTPError(403, "sourceKey is not an accepted page object key.")

    destination = DESTINATION_KEY.fullmatch(request.destination_key)

    if not destination:
        raise ProcessorHTTPError(
            403,
            "destinationKey is not an accepted rectified page object key.",
        )

    source_identity = (
        source.group("user"),
        source.group("book"),
        source.group("object"),
    )
    destination_identity = (
        destination.group("user"),
        destination.group("book"),
        destination.group("object"),
    )

    if source_identity != destination_identity:
        raise ProcessorHTTPError(
            403,
            "destinationKey must be derived from sourceKey.",
        )


def _encode_result(result: RectifyResult) -> bytes:
    encoded, buffer = cv2.imencode(
        ".jpg",
        result.image,
        [int(cv2.IMWRITE_JPEG_QUALITY), OUTPUT_QUALITY],
    )

    if not encoded:
        raise ProcessorHTTPError(500, "Could not encode the result.")

    return buffer.tobytes()
