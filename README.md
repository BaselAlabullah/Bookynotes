# Marginalia

Annotation and retrieval for physical books.

Photograph a page of a paper book, drag a rectangle over a passage, and write a
note against it. A vision model transcribes the words inside that rectangle and
pulls out the surrounding context, so the note is stored with the text it refers
to rather than with a page number. Everything you have ever marked is then
searchable across your whole library.

> Status: phase 8.5 of 9. Feature complete and design-complete: add a book,
> photograph a page, mark a passage, have a vision model transcribe it, and
> search every annotation you have ever made. Deployment remains. Phases are
> tracked at the bottom of this file.

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
4. **Every page has two views.** The photograph, with rectangles anchored to
   normalized coordinates, and a reading view of the page as real reflowing
   text. The photograph stays canonical: a transcript is what a model believed
   it read, and switching back to check is one click.
5. **The storage bucket is private.** Uploads use a signed URL issued by the
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
cp .env.example .env.local   # then fill it in
npm run dev                  # http://localhost:3000
```

On Windows, `run.bat` starts both halves at once — the Next app and the optional
`page-processor` — each in its own window, creating the Python virtualenv on
first run. It reads the processor's secret from `.env.local` so there is one
copy of it rather than two, and skips the processor entirely if it is not
configured.

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

## The page-processor (optional)

`page-processor/` is a small FastAPI service that flattens the perspective out
of a photographed page and evens its lighting. It is the one Python component,
and it is Python for one reason: OpenCV.

```
photograph of a tilted, unevenly lit page
        |  POST /rectify
        v
flat, square, evenly lit page  ->  becomes the canonical image
                                   the photograph is kept alongside it
```

You drag four handles onto the page corners before uploading, and it warps to
those. Automatic detection is tried when you don't — but it needs a flat page on
a contrasting surface, and a book held open rarely gives it one, so the handles
are the primary path rather than a fallback (DECISIONS 0068).

It runs at **upload time, before the page row exists**, which is the only moment
changing an image's geometry is safe — nothing can be anchored to it yet.
Annotations are fractions of the image, so flattening a page that already had
marks would move every one of them.

**It is entirely optional.** Leave `PAGE_PROCESSOR_URL` unset and photographs are
stored exactly as uploaded, with nothing else behaving differently. That is how
the deployed instance runs. See `page-processor/README.md` to run it, and
DECISIONS 0064-0067 for why it exists in this shape.

## Deployment

Vercel, free tier, no card.

### 1. Environment variables

Set these in **Project Settings → Environment Variables** *before the first
build*. `NEXT_PUBLIC_*` values are compiled into the browser bundle, so changing
one later requires a redeploy — setting it afterwards changes nothing already
built.

| Variable | Value | Secret |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://<your-project>.vercel.app`, no trailing slash | no |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | no |
| `DATABASE_URL` | Transaction pooler, port **6543** | yes |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | yes |
| `SUPABASE_STORAGE_BUCKET` | `page-images` | no |
| `GEMINI_API_KEY` | Google AI Studio key | yes |

Optional, each with a working default: `VISION_PROVIDER` (`gemini`),
`GEMINI_VISION_MODEL` (`gemini-3.5-flash`), and the `OPENROUTER_*` pair if you
switch providers.

**Do not set `DATABASE_MIGRATION_URL`.** It is only read by `drizzle.config.ts`,
which never runs on Vercel — migrations are applied deliberately from your own
machine, not on deploy.

### 2. Supabase has to be told the new origin

**Authentication → URL Configuration**:

- **Site URL** → your production URL
- **Redirect URLs** → add `https://<your-project>.vercel.app/**`

Skip this and sign-up appears to work while the confirmation link points
somewhere else.

### 3. Deploy

Import the repository at vercel.com/new. The framework preset is detected; the
build command and output directory need no changes.

### 4. Migrations are not automatic

`npm run db:migrate` is run by you, against the same database. Nothing on Vercel
applies schema changes — that is deliberate, so a deploy can never surprise you
with a migration. Check `npm run db:generate` produced no pending files before
deploying a schema change.

### Region

`vercel.json` pins functions to `hnd1` (Tokyo) because the Supabase project is
in `ap-northeast-1`. On Vercel's default region every query would cross the
Pacific, several times per page, and the app would be measurably slower deployed
than it is locally. See DECISIONS 0060.

If you ever move the Supabase project, change this to match it.

### After the first deploy, check

- `/api/health` returns `{"status":"ok"}`
- Sign in works, and the session survives a page reload
- A book cover loads (it is served from your bucket, not Open Library)
- A page image loads, and an annotation lands where you draw it
- Extraction produces a passage — this is the slowest path and the one most
  likely to hit a free-tier rate limit

## Performance notes

The app talks to Supabase in Tokyo, so every avoidable round trip is worth about
200-290ms. Measured on a production build with a twelve-page book of 2 MB
photographs (DECISIONS 0053-0058):

| | before | after |
| --- | --- | --- |
| `/library` | 1071 ms | 393 ms |
| `/books/[id]` | 1850 ms | 429 ms |
| page view | 2550 ms | 799 ms |
| book grid download | 24.17 MB | 0.19 MB |

What made the difference, in order of size:

- **Thumbnails.** `sharp` generates a 480px JPEG at upload; grids and filmstrips
  use it. CSS only changes how many pixels are painted, never how many are
  fetched. Run `npm run backfill:thumbnails` for pages uploaded before this
  existed.
- **Book covers are copied into our own bucket** at add time. Open Library's CDN
  takes 1.5 to 5 seconds to answer; ours takes 48 to 138ms warm. Run
  `npm run backfill:covers` for books added before this existed.
- **The connection pool.** `max: 1` meant `Promise.all` queued behind one
  connection and bought nothing.
- **Local session verification.** The access token's signature is checked
  against the project's JWKS rather than by asking the auth server: 1ms instead
  of 284ms, three times per navigation.
- **Batched, cached signed URLs.** One request instead of one per image, and a
  stable URL so the browser's image cache can actually hit.
- **`loading.tsx` at every route**, so navigation paints immediately.

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
- **Vision free-tier quota is per model and PER DAY, and it is small.** Measured
  on a real key, `gemini-3.5-flash` allows **20 requests a day** — one afternoon
  of testing exhausts it. The default is `gemini-3.5-flash-lite`, chosen for
  that reason rather than for speed; on transcription quality the two were
  indistinguishable. Because the quota is per model, switching
  `GEMINI_VISION_MODEL` grants a fresh allowance immediately.
- **Vision APIs are rate limited per minute and per day.** Free-tier 429s are
  routine, not exceptional. They are handled explicitly with backoff, and a
  terminal failure surfaces a retry button rather than disappearing. A rate
  limit does not consume the retry budget, so one bad afternoon cannot mark good
  annotations permanently failed.
- **Serverless caps how long you can wait.** In-request retries are three
  attempts a few hundred milliseconds apart, not a patient exponential backoff:
  a long wait would be killed by the function's wall-clock limit and the user
  would see nothing. Anything longer becomes a retry button.
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
| 7 | Enrichment: provider interface, pending, backoff, retry | done |
| 8 | Full-text search with tsvector and GIN | done |
| 8.5 | Aesthetic overhaul before anything is public | done |
| 9 | Deploy to Vercel and verify end to end | done |
| 10 | Python page-processor: rectify and clean page photographs | done |
