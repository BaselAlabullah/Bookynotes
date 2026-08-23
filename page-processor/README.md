# page-processor

A small FastAPI service that flattens the perspective out of a photographed book
page while preserving its natural colours.

It is the one Python component in an otherwise TypeScript project, and it is
Python for a specific reason: OpenCV. Detecting a page outline and warping it
flat is a solved problem there and an unpleasant one in the JavaScript
ecosystem.

```
app/
  main.py      the FastAPI app and its single endpoint
  rectify.py   finding the page outline, and the perspective warp
  config.py    settings, validated at import
tests/
  test_rectify.py   synthetic warped pages with known ground truth
```

## What it does

```
POST /rectify        JSON, header X-API-Key
  {
    "sourceKey": "<user>/<book>/<uuid>.jpg",
    "destinationKey": "<user>/<book>/<uuid>.flat.jpg",
    "corners": [[x, y], [x, y], [x, y], [x, y]] | null
  }
  -> {
    "rectified": true,
    "confidence": 1.0,
    "width": 1200,
    "height": 1700,
    "corners": [[x, y], ...] | null,
    "source": "manual" | "detected"
  }

GET  /health         liveness, no key required
```

The service reads `sourceKey` from the private Supabase Storage bucket and
uploads the JPEG result to `destinationKey`. The app never sends image bytes to
the processor or receives image bytes back from it, which keeps the contract
inside Vercel's function body limits.

## Corners beat detection

When `corners` is supplied, detection is skipped entirely — and that is the
better path, not a fallback. Automatic detection needs a flat page with four
findable edges on a contrasting background. A book held open has a curved spine,
a thumb over one corner and cream paper on a white desk: there is frequently no
quadrilateral to find. Somebody looking at the picture has none of those
problems and can place four points in seconds.

The app drags them over a preview before uploading. Detection below is what runs
when nobody has.

Bad corners are refused with a 400 rather than silently ignored — the reader
placed them, so substituting something else would be baffling.

## The four steps (when detecting)

1. **Find the page.** Downscale, bilateral filter, Canny with thresholds derived
   from the image's own median, dilate to close broken edges, then look for the
   largest contour that simplifies to four points.
2. **Order the corners.** `findContours` returns them in whatever order it
   walked the outline. Unordered corners produce an image that is rotated or
   mirrored, which looks like a bug in the warp and is really a bug here.
3. **Size the output from the page's own edges.** The *longer* of each opposing
   pair — the near edge of a tilted page is longer than the far one, and picking
   the far one squashes the result.
4. **Warp without restyling.** Perspective correction changes the page shape,
   but the returned pixels keep the photograph's natural colour and lighting.
   The web app offers a scan-like display filter when a reader wants higher
   contrast; that choice never changes the saved page or its annotation geometry.

Everything else in `rectify.py` is guarding against step 1 finding something
that is not a page — the image border, a shadow, a book cover on a desk.
**A confident wrong answer is much worse than admitting defeat**, so a detection
must be convex, cover between 20% and 99.5% of the frame, and have no corner
outside 45–135 degrees. Failing any of those returns the original with a
confidence of 0, which the caller treats as a perfectly normal outcome.

It deliberately does **not** binarise. Thresholding to pure black and white is
the classic scanner look and it throws away pencil annotations, printed
photographs and the anti-aliasing that makes small type readable — and a vision
model reads the result worse, not better.

## Running it

```bash
cd page-processor
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
# .venv/bin/pip install -r requirements.txt                   # macOS / Linux

PAGE_PROCESSOR_SECRET=<same value as the Next app> \
NEXT_PUBLIC_SUPABASE_URL=<project URL> \
SUPABASE_SECRET_KEY=<service-role key> \
SUPABASE_STORAGE_BUCKET=page-images \
  .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
```

Then set the processor variables in the Next app's `.env.local`:

```
PAGE_PROCESSOR_URL=http://127.0.0.1:8000
PAGE_PROCESSOR_SECRET=<the same secret>
```

They must be set together or not at all — the app refuses to start otherwise,
because a URL without a secret means posting images to an unauthenticated
endpoint.

**Leave both unset and nothing breaks.** Page photographs are then stored exactly
as uploaded. That graceful degradation is still the point: a feature that only
works when an extra process happens to be running has to degrade to "the app as
it was", or it is not optional at all.

## Tests

```bash
PAGE_PROCESSOR_SECRET=test .venv/Scripts/python.exe -m tests.test_rectify
```

They build a flat page, warp it by a *known* perspective transform onto a dark
desk with a lighting gradient, and check that rectifying undoes it. Because the
ground truth is constructed rather than guessed at, the assertions are about
numbers — corner error under 2% of the image, restored aspect ratio within 5% of
the original — rather than "it looks better".

## The secret is not authorization

This service takes storage keys and returns metadata. It holds no database and
decides nothing about who may see what: the Next app establishes ownership long
before it calls here. The key exists so that a public function or a process
listening on a port cannot be used as free image processing by anything else
that can reach it.

The service validates that the destination key is derived from the source key
before it reads or writes storage. That is not user authorization; it is a guard
against turning the processor secret into a general bucket editor.
