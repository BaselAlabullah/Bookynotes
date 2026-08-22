# integrations/page-processor

The client for the Python service in `page-processor/`, which flattens the
perspective out of page photographs while preserving their natural appearance.

```
page-processor.types.ts    RectifiedPage, PageProcessorError
page-processor.client.ts   rectifyPage(), isPageProcessorConfigured()
```

**This is the only optional integration in the app.** `PAGE_PROCESSOR_URL` may be
unset — on the deployed instance it usually is, because the service runs on a
laptop — and then `rectifyPage` returns null and the upload proceeds with the
photograph exactly as it arrived.

Every failure returns null rather than throwing: not configured, unreachable,
timed out, refused the image, or looked and found no page. Only the caller knows
whether any of that is worth mentioning, and in this case none of it is.

The initial work happens in `pages.service.ts` at upload time, before the
`pages` row exists. Saved corners can later be adjusted through the same client;
existing note rectangles are projected into the replacement geometry in the
same database transaction. See DECISIONS 0065 and 0094.
