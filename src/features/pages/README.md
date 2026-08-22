# features/pages

A photographed page belonging to a book.

```
pages.types.ts         Page and NewPage
pages.schema.ts        zod for both upload steps, and the responses the browser reads
pages.storage-key.ts   where an object lives in the bucket, and who it belongs to
pages.repository.ts    every query against the pages table; userId first, always
pages.service.ts       prepareUpload and completeUpload
components/            the uploader and the page grid
```

## The upload flow

```
  browser                     this app                    supabase storage
     |  POST /api/pages/upload-url  |                             |
     |----------------------------->|  check the book is yours    |
     |                              |  build <userId>/<bookId>/…  |
     |                              |---- createSignedUploadUrl -->|
     |<--- url + token + key -------|                             |
     |                                                            |
     |  PUT the file, straight to Supabase ---------------------->|
     |                                                            |
     |  POST /api/pages             |                             |
     |----------------------------->|  key really starts with     |
     |                              |  this user's prefix?        |
     |                              |---- objectExists? --------->|
     |                              |  INSERT INTO pages          |
     |<--- 201 ---------------------|                             |
```

Image bytes never pass through the app server. On a serverless free tier that is
not a nicety: a 10 MB upload through a function burns execution time and memory
for nothing, and request-body limits are often well below that.

## Rules

- **No row until the object exists.** A `pages` row always means a real image.
  The failure mode is an orphaned object, which is invisible and cheap.
- **The storage key is user input on the second request.** It is checked against
  the `<userId>/<bookId>/` prefix, not looked up.
- **`imageWidth` and `imageHeight` are client-reported** and cannot be verified
  without pulling the bytes through our server. Every annotation coordinate in
  phase 6 is a fraction of them. See DECISIONS 0028.
- **Duplicate page numbers are caught by the unique constraint**, not by a
  read-then-write check that would race.

## Known gap

Deleting a page row does not delete its object. Postgres cascades govern rows
and know nothing about a bucket, so a deleted page, book or user leaves its
images behind. Nothing triggers this yet — there is no delete UI. When one is
added, remove the object first and the row second, so a failure leaves a
recoverable orphan rather than a row pointing at nothing.

## Straightening a page

The uploader shows a preview with four draggable handles before anything is
sent. Those corners travel with the confirm request, and the page-processor
warps to them without detecting anything.

That is the primary path, not a fallback. Automatic detection assumes a flat
page with four findable edges against a contrasting background; people
photograph books held open, with a curved spine, a thumb across a corner and
cream paper on a white desk. See DECISIONS 0068.

The corners are normalized, like every other coordinate here, and stored on the
row so the flattening can be redone without dragging them again. Uncheck
"Straighten the page" and the photograph is stored exactly as taken.

The page's Original view also offers **Adjust page corners** after upload. It
always edits against the retained source photograph and writes the new flattened
page and thumbnail under fresh keys before changing the row. Existing region
annotations are projected from the old crop through the source photograph into
the new crop in the same database transaction as the page update. A crop that
would remove an existing annotation is refused rather than silently moving or
destroying the note.

## Reading view

Every page has two views, and they are genuinely different things rather than
one thing rendered twice:

| | anchor | what it is |
| --- | --- | --- |
| **Original** | normalized coordinates | the photograph. It cannot be wrong, because it is not an interpretation. |
| **Reading** | (text ranges, next step) | the transcript. What a model believed it read. |

The transcript is real reflowing text, not a picture of text — selectable,
copyable, resizable, readable by a screen reader. Rendering it back into an
image would have looked like an e-book without being one. See DECISIONS 0070.

Transcription runs in its own request (`POST /api/pages/<id>/transcribe`) and is
cached on the row, for the same reasons enrichment is: a write never waits on a
model, and a whole page is the most expensive call this app makes.

**The integrity check.** The model is also asked for the page number printed on
the page. When that disagrees with the number the page was filed under, the
reading view says so. It catches a mis-typed page number and a model reading the
wrong thing with the same test, and it costs one field in a call already being
made. See DECISIONS 0071 — and 0072 for the false alarm that prompted it.
