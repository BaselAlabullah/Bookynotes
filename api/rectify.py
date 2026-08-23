import json
from http.server import BaseHTTPRequestHandler
import hmac
import os

from app.storage_rectify import ProcessorHTTPError, rectify_storage_json_body


def _json_bytes(payload):
    return json.dumps(payload).encode("utf-8")


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._send_json(200, {"status": "ok"})

    def do_POST(self):
        if not self._has_valid_key():
            self._send_json(401, {"detail": "Invalid or missing X-API-Key."})
            return

        content_length = self.headers.get("Content-Length")

        try:
            length = int(content_length or "0")
        except ValueError:
            self._send_json(400, {"detail": "Invalid Content-Length."})
            return

        body = self.rfile.read(length)

        try:
            result = rectify_storage_json_body(body)
        except ProcessorHTTPError as error:
            self._send_json(error.status_code, {"detail": error.detail})
            return

        self._send_json(200, result.as_json())

    def _has_valid_key(self):
        expected = os.environ.get("PAGE_PROCESSOR_SECRET", "")
        provided = self.headers.get("X-API-Key", "")

        return bool(expected) and hmac.compare_digest(provided, expected)

    def _send_json(self, status_code, payload):
        body = _json_bytes(payload)
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
