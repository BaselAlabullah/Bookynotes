# integrations/storage

Supabase Storage. Issues signed upload URLs and signed read URLs for a private
bucket, and nothing else knows the bucket name or the URL lifetimes.

```
storage.types.ts     SignedUpload, SignedRead, StorageError
storage.client.ts    createSignedUpload, createSignedRead, objectExists, removeObject
```

The bucket (`page-images`) is private, capped at 10 MB per object, and accepts
only JPEG, PNG and WebP. Those limits live on the bucket rather than in
application code, because the app server never sees the bytes — a check here
would be advice, not enforcement.

Two things to know:

- **The client is a module-level singleton, unlike the auth one.** It carries no
  user session, so there is nothing belonging to one request that could leak
  into the next. `features/auth/supabase-server.ts` must be per-request for
  exactly the opposite reason.
- **The secret key bypasses row level security, and that is the point.** The
  bucket is private and `storage.objects` denies everything by default, so
  nothing else could issue a URL. The key never decides anything: every caller
  has already established ownership before reaching this file.

Read URLs last five minutes and are signed at render time, never stored. See
DECISIONS 0027.
