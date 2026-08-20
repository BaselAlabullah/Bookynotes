# Marginalia

Annotation and retrieval for physical books.

Photograph a page of a paper book, drag a rectangle over a passage, and write a
note against it. A vision model transcribes the words inside that rectangle and
pulls out the surrounding context, so the note is stored with the text it refers
to rather than with a page number. Everything you have ever marked is then
searchable across your whole library.

> Status: phase 6 of 9. You can sign up, add books, upload page photographs, and
> mark passages on them with coordinate-anchored annotations. The vision model
> arrives next. Phases are tracked at the bottom of this file.

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
   a phone, a laptop, and a zoomed-in canvas. The SVG overlay's `viewBox` is the
   unit square, which means stored coordinates are the overlay's own coordinate
   system — there is no projection code on the render path, and no
   `ResizeObserver` anywhere in the project.
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

Access control is one rule, applied in one layer: every repository function
takes a `UserId` and puts it in the WHERE clause. Ids are branded types, so the
compiler rejects a `BookId` passed where a `UserId` belongs. A repository reads
only its own table; when a write needs to prove ownership of a parent row — a
page inside a book, an annotation on a page — that check lives in the feature's
service.

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

### Storage

Phase 5 needs a private bucket and the Supabase **secret key**
(`sb_secret_...`, formerly `service_role`) in `SUPABASE_SECRET_KEY`. The bucket
`page-images` is private, capped at 10 MB per object and limited to JPEG, PNG
and WebP; those limits are set on the bucket itself, because the app server
never sees the bytes and so cannot enforce them.

### Database

Create a free Supabase project (no card required), then from
**Project Settings → Database → Connection string** copy two URLs into
`.env.local`:

| Variable | Which connection | Why |
| --- | --- | --- |
| `DATABASE_URL` | Transaction pooler, port 6543 | Runtime. Serverless opens a connection per invocation. |
| `DATABASE_MIGRATION_URL` | Session pooler, port 5432 | Migrations. DDL needs a session that outlives one statement. |

Use the session pooler host (`aws-<n>-<region>.pooler.supabase.com`), not the
direct `db.<ref>.supabase.co` one. The direct endpoint has been IPv6-only since
January 2024 unless you buy the IPv4 add-on, so IPv4-only clients — GitHub
Actions runners among them — cannot reach it.

Then:

```bash
npm run db:generate          # after any change to src/db/schema
npm run db:migrate           # apply pending migrations
```

Never run `drizzle-kit push`. It diffs against the live database and would drop
the foreign keys added by `0001_auth_user_foreign_keys.sql`. See
`src/db/README.md`.

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
- **Vercel meters optimised images on the free tier.** Book covers are rendered
  with a plain `<img>` rather than `next/image`: they are already small and
  already on Open Library's CDN, so re-optimising them spends quota for nothing.
- **Vision APIs are rate limited per minute and per day.** Free-tier 429s are
  routine, not exceptional. They are handled explicitly with backoff, and a
  terminal failure surfaces a retry button rather than disappearing.
- **Supabase pauses idle projects.** A free project that goes untouched for
  about a week is suspended until you open the dashboard again. Worth knowing
  before a demo.
- **No `next/font`.** It downloads font files during the build, which makes the
  production build depend on network access to Google Fonts. A system font stack
  costs nothing and cannot fail.
- **Supabase's built-in email sender is rate limited to a handful of messages an
  hour** and is explicitly not for production. If you leave email confirmation
  enabled, sign-up appears to work and the email silently never arrives. Either
  turn confirmation off (Auth -> Providers -> Email) or configure custom SMTP.
- **Confirmation links need a template change.** Supabase's default email
  template uses the implicit flow, which puts tokens in the URL fragment where
  only the browser can see them. To reach `/auth/confirm`, set the template to
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`.

## Phases

| # | Phase | Status |
| --- | --- | --- |
| 1 | Scaffold, config, folder structure, docs | done |
| 2 | Supabase, schema, Drizzle migrations, scoped data access | done |
| 3 | Auth: sign up, sign in, protected routes, sessions | done |
| 4 | Books: Open Library search, create, library view | done |
| 5 | Pages: direct-to-storage upload, signed reads, page view | done |
| 6 | Canvas layer: normalized coordinates, pins, resize and zoom | done |
| 7 | Enrichment: provider interface, pending, backoff, retry | |
| 8 | Full-text search with tsvector and GIN | |
| 9 | Deploy to Vercel and verify end to end | |
