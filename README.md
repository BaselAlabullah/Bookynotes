# Marginalia

Annotation and retrieval for physical books.

Photograph a page of a paper book, drag a rectangle over a passage, and write a
note against it. A vision model transcribes the words inside that rectangle and
pulls out the surrounding context, so the note is stored with the text it refers
to rather than with a page number. Everything you have ever marked is then
searchable across your whole library.

> Status: phase 1 of 9. Scaffold only — no features yet. Phases are tracked at
> the bottom of this file.

## Architecture

```
  browser
    |
    |  1. photo bytes, direct to storage (never through the app server)
    |------------------------------------------------> Supabase Storage
    |                                                     (private bucket)
    |  2. everything else
    v
  Next.js on Vercel  ......  server components + route handlers
    |     |                  no separate backend: nothing runs between requests
    |     |
    |     |  3. annotation row written immediately as 'pending'
    |     v
    |   Supabase Postgres  <--- Drizzle ORM, SQL migrations in the repo
    |                           user_id on every table, scoped in repositories
    |
    |  4. enrichment, on a later request
    v
  Vision provider  ......  Gemini Flash by default, OpenRouter as fallback
                           swapped by env var behind one interface
```

Four ideas carry most of the design:

1. **Coordinates are normalized.** An annotation rectangle is stored as four
   floats in `0.0..1.0` against the image's intrinsic dimensions. Pixels are
   never stored or passed across a boundary, so a pin lands in the same place on
   a phone, a laptop, and a zoomed-in canvas.
2. **Writes never wait on the model.** Creating an annotation returns straight
   away with `enrichment_status = 'pending'`. Enrichment happens in a separate
   request and updates the row; the client watches for the change.
3. **Enrichment is cached on the row.** The same region is never sent to the
   model twice — which is what makes a free tier survivable.
4. **The storage bucket is private.** Uploads use a signed URL issued by the
   backend and go browser → Supabase directly. Reads use short-lived signed
   URLs. Image bytes never transit the app server.

## Repository layout

```
src/
  app/           routing only — pages and route handlers, no logic
  features/      domain code: auth, books, pages, annotations, search
  integrations/  external systems behind a thin interface: vision, open-library, storage
  db/            Drizzle client, schema, migrations
  components/ui/ presentational primitives with no domain knowledge
  config/        the only two files that read process.env
docs/
  DECISIONS.md   append-only log of every real fork in the road
```

Every directory contains a `README.md` stating its single responsibility. Start
with `src/features/README.md` — it defines the shape every feature follows.

## Local setup

Requires Node 22+.

```bash
npm install
cp .env.example .env.local   # then fill in the phase 1 values
npm run dev                  # http://localhost:3000
```

Checks:

```bash
npm run typecheck            # tsc --noEmit, strict
npm run lint
npm run build
```

The app refuses to start if a required environment variable is missing or
malformed, by design — see `src/config/env.public.ts`.

## Free-tier gotchas

Notes on the things that actually bite, collected as we hit them.

- **Serverless has no background.** Vercel functions end when the response is
  sent. Work started and not awaited is killed. This is why enrichment is a
  separate request rather than a fire-and-forget after the annotation write.
- **Postgres connections.** Each serverless invocation opens its own connection,
  so runtime traffic must use Supabase's transaction pooler (port 6543).
  Migrations need the direct connection (5432) instead, because the transaction
  pooler cannot hold the locks DDL requires. Hence two connection strings.
- **Vision APIs are rate limited per minute and per day.** Free-tier 429s are
  routine, not exceptional. They are handled explicitly with backoff, and a
  terminal failure surfaces a retry button rather than disappearing.
- **Supabase pauses idle projects.** A free project that goes untouched for
  about a week is suspended until you open the dashboard again. Worth knowing
  before a demo.
- **No `next/font`.** It downloads font files during the build, which makes the
  production build depend on network access to Google Fonts. A system font stack
  costs nothing and cannot fail.

## Phases

| # | Phase | Status |
| --- | --- | --- |
| 1 | Scaffold, config, folder structure, docs | done |
| 2 | Supabase, schema, Drizzle migrations, scoped data access | |
| 3 | Auth: sign up, sign in, protected routes, sessions | |
| 4 | Books: Open Library search, create, library view | |
| 5 | Pages: direct-to-storage upload, signed reads, page view | |
| 6 | Canvas layer: normalized coordinates, pins, resize and zoom | |
| 7 | Enrichment: provider interface, pending, backoff, retry | |
| 8 | Full-text search with tsvector and GIN | |
| 9 | Deploy to Vercel and verify end to end | |
