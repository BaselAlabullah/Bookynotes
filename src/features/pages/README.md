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
