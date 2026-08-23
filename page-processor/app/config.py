"""Settings, read once at import and validated immediately.

Same rule as the TypeScript side: a missing secret is a service that refuses to
start, not one that accepts unauthenticated requests until someone notices.
"""

from __future__ import annotations

import os


class ConfigurationError(RuntimeError):
    pass


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()

    if not value:
        raise ConfigurationError(
            f"{name} is required. See page-processor/README.md."
        )

    return value


#: Shared with the Next app, which sends it as X-API-Key.
#:
#: This service takes storage keys and returns metadata. It holds no user data
#: and makes no authorization decisions. The secret is here so that a process
#: listening on a port cannot be used as free image processing by anything else
#: on the machine or the network.
API_KEY = _required("PAGE_PROCESSOR_SECRET")

#: Supabase project origin, e.g. https://<ref>.supabase.co.
#:
#: The variable name intentionally matches the Next app's public value. The URL
#: is not secret, and reusing it avoids a second spelling that can drift in
#: local and Vercel environments.
SUPABASE_URL = _required("NEXT_PUBLIC_SUPABASE_URL").rstrip("/")

#: Service-role key used only after the Next app has already made the ownership
#: decision. The Python service still validates object-key shape itself because
#: storage keys are now input.
SUPABASE_SECRET_KEY = _required("SUPABASE_SECRET_KEY")

#: Name of the private bucket holding page photographs.
SUPABASE_STORAGE_BUCKET = _required("SUPABASE_STORAGE_BUCKET")

#: Refuse anything larger. The bucket caps uploads at 10 MB, so this is the same
#: ceiling expressed where this service can enforce it itself.
MAX_UPLOAD_BYTES = int(os.environ.get("PAGE_PROCESSOR_MAX_BYTES", 10 * 1024 * 1024))

#: JPEG quality for the returned page. High, because this becomes the canonical
#: image that every later crop and thumbnail is derived from.
OUTPUT_QUALITY = int(os.environ.get("PAGE_PROCESSOR_QUALITY", 90))
