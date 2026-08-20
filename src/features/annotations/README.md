# features/annotations

A normalized rectangle on a page, the user's note, and whatever the vision model
reads inside that rectangle.

```
annotations.types.ts        Annotation, NormalizedRect, and the two anchor guards
annotations.text.ts         paragraph offsets and context, shared by browser and server
annotations.schema.ts       zod bounds for the rectangle and the create input
annotations.repository.ts   every query against the annotations table
annotations.service.ts      createAnnotation, with the page ownership check
annotations.actions.ts      createAnnotationAction, a Server Function
components/
  annotation-canvas.tsx     the image, the SVG overlay, the pointer maths
  page-annotator.tsx        state: selection, draft rectangle, zoom
```

## Coordinates

Every rectangle is four floats in `0.0..1.0`, relative to the page image's
intrinsic size. Pixels are never stored and never cross a boundary.

The rendering side needs no projection code at all, because the SVG overlay's
`viewBox` is `0 0 1 1` — the unit square. A stored rectangle is written into the
element unchanged:

```
row:  rect_x 0.2   rect_y 0.5   rect_width 0.3   rect_height 0.04
DOM:  <rect x="0.2" y="0.5" width="0.3" height="0.04">
```

From that one choice:

- **Resize needs no code.** There is no `ResizeObserver` anywhere in this
  project. The browser re-projects the pins because they were never in pixels.
- **Zoom needs no matrix.** Zoom sizes a wrapper element; panning is the scroll
  container's own behaviour. 1x means the whole page fits, using a `max-width`
  derived from the stored intrinsic dimensions, so nothing is measured. See
  DECISIONS 0032 and 0036.
- **Only one place converts screen to image**, and it is four lines in
  `annotation-canvas.tsx`. `getBoundingClientRect()` reports the painted box, so
  it is already correct under zoom and scroll.

Two details that look like fussiness and are not:

- `preserveAspectRatio="none"` — x and y must scale independently, because a
  normalized x is a fraction of width and a normalized y is a fraction of
  height.
- `vector-effect="non-scaling-stroke"` — a stroke width in unit-square
  coordinates would be about half the page wide.

Labels are HTML positioned with percentages rather than SVG text, because
non-uniform scaling stretches glyphs. Same numbers, no distortion.

## Writes never wait on the model

`createAnnotation` returns as soon as the row is written. The row is born
`enrichment_status = 'pending'` with `retry_count = 0`, and
`annotations.service.ts` does not know the vision model exists.

Enrichment is a separate request, `POST /api/annotations/<id>/enrich`, run by
`annotations.enrichment.ts`:

```
find the annotation (scoped)
  already 'complete' and not forced?  -> return it, model not called
fetch the page image via a signed URL
crop it for the model                 -> annotations.crop.ts
call the provider with retries        -> integrations/vision
  success   -> extracted_passage + extracted_context, status 'complete'
  rate limit-> status stays 'pending', budget NOT consumed
  transient -> retry, then 'pending' or 'failed' once attempts run out
  permanent -> 'failed' immediately, never retried
```

If that request never happens, the annotation is still saved and still correct.
It simply has no passage yet, and the list offers a button.

`enrichment_status = 'complete'` is the cache: the same region is never sent to
the model twice. The only exception is the user's own "try again" on a failed
row, which also resets the attempt budget — asking again is a fresh decision,
not a continuation of our automatic attempts.

## What the model actually sees

Not the raw photograph. `annotations.crop.ts` produces a padded crop, grayscaled
and contrast-normalised, with the reader's own rectangle drawn on it in red — so
the region is shown rather than described in coordinates the model has to
resolve. See DECISIONS 0039.

The crop is computed against the dimensions `sharp` decodes, not the ones stored
on the page row, so a browser that reported the wrong size still gets the right
crop.

## Two anchors

An annotation attaches to one of two surfaces, and they need different anchors:

| anchor | attached to | why |
| --- | --- | --- |
| `region` | the photograph | fractions of the image, so a pin lands correctly at any size |
| `text` | the transcript | a character range, so it survives reflow |

A rectangle over reflowing text means nothing the moment the window changes
width, and a character offset into a photograph means less. One table holds
both, with a check constraint guaranteeing exactly one anchor is populated —
see DECISIONS 0076.

**A text annotation costs no model call.** The reader selected the words, so the
passage *is* the selection and the context is a slice of the transcript. It is
born `complete`: no pending state, no retry, no quota. On a free tier of twenty
calls a day that is the difference between a feature you use and one you ration.

**The quote is stored beside the offsets**, deliberately redundant. Offsets
drift if a page is transcribed again; the quote is what makes that detectable,
and what gets displayed regardless. A selection whose quote no longer matches
its range is refused rather than stored.

`annotations.text.ts` does the offset arithmetic and runs in both the browser
and the server — if the two disagreed about where a paragraph begins, every
annotation would be wrong by the difference. It has a test, because its failure
mode is silence rather than a crash: `npm run test:offsets`.
