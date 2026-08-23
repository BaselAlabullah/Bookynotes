# integrations/page-processor

The client for the Python service in `page-processor/`, which flattens the
perspective out of page photographs while preserving their natural appearance.

```
page-processor.types.ts    RectifiedPage, PageProcessorError
page-processor.client.ts   rectifyPage(), isPageProcessorConfigured()
```

**This is the only optional integration in the app.** `PAGE_PROCESSOR_URL` may be
unset, and then `rectifyPage` returns null and the upload proceeds with the
photograph exactly as it arrived. Locally it usually points at
`http://127.0.0.1:8000`; in production it can point at this Vercel project's
`/api` base so `rectifyPage` reaches the Python function at `/api/rectify`.

Every processor failure returns null rather than throwing: not configured,
unreachable, timed out, or refused the image. A successful response contains
metadata only; the Python service has already written the derived JPEG to the
destination storage key.

The initial work happens in `pages.service.ts` at upload time, before the
`pages` row exists. Saved corners can later be adjusted through the same client;
existing note rectangles are projected into the replacement geometry in the
same database transaction. See DECISIONS 0065 and 0094.
