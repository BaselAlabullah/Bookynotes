# Bookynotes

**Annotation and retrieval for physical books.**

Photograph a page of a paper book. Drag a rectangle over a passage, or select
the words directly in a clean transcript, and write a note against it. The note
is stored with *the text it refers to* — not with a page number — so everything
you have ever marked stays searchable across your whole library.

**Live:** https://bookynotes.vercel.app

---

## The problem

Marginalia in a paper book is write-only. You underline something on page 240
of a novel, and two years later you remember that the passage exists but not
which book, which page, or what it actually said. Meanwhile every digital
reader has full-text search over everything you highlighted.

Bookynotes closes that gap without asking you to stop reading paper. You take a
photo, mark the passage, and the app does the work of turning that image into
something searchable.

---

## Features

### Build a library

Search Open Library by title or author and add a book in one click. Covers are
copied into the app's own storage on add, so the library grid loads from one
bucket instead of waiting on an external CDN.

Books, pages and annotations can all be deleted. Before a destructive delete,
the app tells you exactly what goes with it — "this book, 12 pages, 34 notes" —
because a cascade you cannot see is a cascade you cannot consent to.

### Capture a page

Upload a photograph by browsing, dragging, or pasting from the clipboard.

Before the upload starts, the browser runs a **capture quality check** — it
looks at resolution, orientation, framing, exposure and contrast, and warns you
about a photo that will be hard to read. The warnings never block the upload.
They are advice, not a gate.

### Straighten the page

Nobody photographs a book flat. A held-open book has a curved spine, a thumb
over one corner, and a page the same colour as the desk.

So you **drag four handles onto the page corners**, and the app warps the
photograph into a flat, rectangular page — with its natural colour and lighting
intact. A zoom preview follows each handle while you position it; arrow keys
nudge, shift steps further.

Automatic corner detection runs when you don't place them yourself, but the
handles are the primary path rather than a fallback, because detection needs a
flat page on a contrasting surface and real photographs rarely provide one.

The original photograph is always kept. You can switch back to it at any time.

**Corners stay editable after the fact.** If you got them wrong, adjust and save
again — the app re-projects every existing annotation through the new geometry
so your notes stay on the words they were about. If a proposed crop would cut
out an existing note, the save is refused rather than silently losing it.

### Read the page as text

Every page has two views:

- **Original** — the photograph, with your rectangles drawn on it.
- **Reading** — the page as real, reflowing, selectable text.

The transcript can come from a vision model reading the whole page, or you can
paste and edit it yourself. Manual transcripts are a first-class path, not a
degraded one: they cost no quota, they are exact, and they let the app work
fully when model quota is gone.

The photograph always stays canonical. A transcript is either what you typed or
what a model believed it read, and checking it against the original is one
click.

### Annotate two ways

**Region annotations** — drag a rectangle on the photograph. A vision model
transcribes the words inside that rectangle and pulls out the surrounding
context, so the note carries the passage with it.

**Text annotations** — select words in the reading view. The exact character
range is stored along with the quoted text. No model involved, no quota spent,
and no transcription error possible.

Both live in one table under one constraint that makes an annotation belong to
exactly one anchor — never both, never neither.

### Search everything

Full-text search across your notes, the passages a model extracted, and the
context around them. Results are grouped by book and page, and each hit says
*where* the match came from — your own note, a passage you selected, a passage a
model read, or the surrounding context — because a correct hit that looks
arbitrary is not much use.

Search is deliberately forgiving about punctuation and case: `he just was` finds
`he just was.....`. That matters more than it sounds, because a phrase made
entirely of stop words produces an empty full-text query and would otherwise
match nothing at all.

### See the state of things

Library and book dashboards show what is captured, transcribed, pending, or
failed — how many pages have transcripts, how many passages are still waiting on
a model, how many failed and can be retried.

---

## How it works

```
  browser
    |
    |  1. photo bytes, direct to storage (never through the app server)
    |------------------------------------------------> Supabase Storage
    |                                                     (private bucket)
    |  2. everything else
    v
  Next.js on Vercel  ......  server components + route handlers
    |     |     |            no separate backend: nothing runs between requests
    |     |     |
    |     |     |  3. annotation row written immediately as 'pending'
    |     |     v
    |     |   Supabase Postgres  <--- Drizzle ORM, SQL migrations in the repo
    |     |                           user_id on every table, scoped in repositories
    |     |
    |     |  4. page rectification, by storage key
    |     v
    |   Python function (OpenCV)  ......  same project, same region
    |                                     reads and writes the bucket directly
    |  5. enrichment, on a later request
    v
  Vision provider  ......  Gemini by default, OpenRouter as fallback
                           swapped by env var behind one interface
```

Five ideas carry most of the design.

**1. Coordinates are normalized.** An annotation rectangle is four floats in
`0.0..1.0` against the image's intrinsic dimensions. Pixels are never stored or
passed across a boundary, so a mark lands in the same place on a phone, a
laptop, and a zoomed-in canvas. The SVG overlay's `viewBox` *is* the unit
square, which means the stored coordinates are the overlay's own coordinate
system — there is no projection code on the render path, and no `ResizeObserver`
anywhere in the project.

**2. Writes never wait on the model.** Creating an annotation returns
immediately with `enrichment_status = 'pending'`. Enrichment happens in a
separate request and updates the row. Failures stay visible and retryable rather
than vanishing.

**3. Enrichment is cached on the row.** The same region is never sent to a model
twice. That is what makes a 20-request-per-day free tier survivable.

**4. Image bytes never transit the app server.** Uploads go browser → Supabase
through a signed URL. Reads use short-lived signed URLs. Rectification passes
*storage keys*, not image data, so the Python function fetches and writes the
bucket itself.

**5. The model is never load-bearing.** Manual transcripts, text annotations,
and retryable extraction each exist so that the app remains fully usable when
there is no quota left at all.

---

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16, App Router | Server components; one deployable, no separate backend |
| Language | TypeScript, strict, no `any` | Branded ID types make `BookId`-where-`UserId`-belongs a compile error |
| Database | Supabase Postgres | Free tier without a card; generated tsvector columns; RLS available |
| ORM | Drizzle | SQL migrations live in the repo and are applied deliberately |
| Storage | Supabase Storage, private bucket | Signed URLs both directions |
| Auth | Supabase Auth | Local ES256 token verification, ~1 ms instead of ~284 ms |
| Images | sharp | Thumbnails at upload |
| Rectification | Python + OpenCV, on Vercel | Homography warp; the one thing Node has no good answer for |
| Vision | Gemini / OpenRouter | Behind one interface, swapped by env var |
| Hosting | Vercel, `hnd1` (Tokyo) | Same region as the database |

---

## Repository layout

```
src/
  app/           routing only — pages and route handlers, no logic
  features/      domain code: auth, books, pages, annotations, search
  integrations/  external systems behind a thin interface: vision, open-library, storage
  db/            Drizzle client, schema, migrations
  components/ui/ presentational primitives with no domain knowledge
  config/        the only two files that read process.env
api/
  rectify.py     Vercel Python function — the deployed rectifier
page-processor/
  app/           the OpenCV algorithm, plus a local FastAPI server
docs/
  DECISIONS.md   append-only log of every real fork in the road
```

**Access control is one rule, applied in one layer.** Every repository function
takes a `UserId` and puts it in the WHERE clause. A repository reads only its
own table; when a write must prove ownership of a parent row — a page inside a
book, an annotation on a page — that check lives in the feature's service.

Every directory contains a `README.md` stating its single responsibility. Start
with `src/features/README.md`; it defines the shape every feature follows.

**`docs/DECISIONS.md` is the most important file in the repository.** It is an
append-only record of every real fork in the road: what the problem was, what
the options were, what was chosen, and why. Entries are never edited — a later
entry supersedes an earlier one and says so.

---

## Running locally

Requires Node 22+.

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev                  # http://localhost:3000
```

On Windows, `run.bat` starts both halves at once — the Next app and the local
`page-processor` — each in its own window, creating the Python virtualenv on
first run. It reads the processor's secret from `.env.local` so there is one
copy of it rather than two.

### Checks

```bash
npm run typecheck            # tsc --noEmit, strict
npm run lint
npm run build
npx vitest run               # projection, storage keys, delete cascade, image recovery
npm run test:offsets         # transcript range/offset invariants

cd page-processor && .venv/Scripts/python.exe -m tests.test_rectify
```

### Maintenance scripts

```bash
npm run backfill:thumbnails  # pages uploaded before thumbnails existed
npm run backfill:covers      # books added before covers were self-hosted
npm run sweep:orphans        # bucket objects with no row (dry-run first)
npm run username             # set a username on an existing account
```

### Database

Create a free Supabase project, then from **Project Settings → Database →
Connection string** copy two URLs into `.env.local`:

| Variable | Which connection | Why |
| --- | --- | --- |
| `DATABASE_URL` | Transaction pooler, port 6543 | Runtime. Serverless opens a connection per invocation. |
| `DATABASE_MIGRATION_URL` | Session pooler, port 5432 | Migrations. DDL needs a session that outlives one statement. |

Use the session pooler host (`aws-<n>-<region>.pooler.supabase.com`), not the
direct `db.<ref>.supabase.co` one — the direct endpoint has been IPv6-only since
January 2024 unless you buy the IPv4 add-on.

```bash
npm run db:generate          # after any change to src/db/schema
npm run db:migrate           # apply pending migrations
```

**Never run `drizzle-kit push`.** It diffs against the live database and would
drop the foreign keys added by `0001_auth_user_foreign_keys.sql`.

### Storage

The bucket `page-images` is private, capped at 10 MB per object, and limited to
JPEG, PNG and WebP. Those limits are set on the bucket itself, because the app
server never sees the bytes and so cannot enforce them.

---

## Deployment

Vercel, free tier, no card.

### 1. Environment variables

Set these in **Project Settings → Environment Variables** *before the first
build*. `NEXT_PUBLIC_*` values are compiled into the browser bundle, so setting
one afterwards changes nothing already built.

| Variable | Value | Secret |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://<project>.vercel.app`, no trailing slash | no |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | no |
| `DATABASE_URL` | Transaction pooler, port **6543** | yes |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | yes |
| `SUPABASE_STORAGE_BUCKET` | `page-images` | no |
| `GEMINI_API_KEY` | Google AI Studio key | yes |
| `PAGE_PROCESSOR_URL` | `https://<project>.vercel.app/api` | no |
| `PAGE_PROCESSOR_SECRET` | any value, 16+ characters | yes |

`PAGE_PROCESSOR_URL` and `PAGE_PROCESSOR_SECRET` must be set **together or not
at all** — the app refuses to start otherwise. A URL without a secret would send
images to an unauthenticated endpoint; a secret without a URL is a half-finished
configuration. Leave both unset and photographs are stored exactly as uploaded,
with nothing else behaving differently.

The same `PAGE_PROCESSOR_SECRET` is read by both halves: Next sends it as
`X-API-Key`, the Python function checks it. One variable, so they cannot drift.

Optional, each with a working default: `VISION_PROVIDER` (`gemini`),
`GEMINI_VISION_MODEL` (`gemini-3.5-flash-lite`), and the `OPENROUTER_*` pair.

**Do not set `DATABASE_MIGRATION_URL`.** It is read only by
`drizzle.config.ts`, which never runs on Vercel.

### 2. Tell Supabase the new origin

**Authentication → URL Configuration**: set **Site URL** to your production URL
and add `https://<project>.vercel.app/**` to **Redirect URLs**. Skip this and
sign-up appears to work while the confirmation link points somewhere else.

### 3. Migrations are not automatic

`npm run db:migrate` is run by you, from your machine, against the same
database. Nothing on Vercel applies schema changes — deliberately, so a deploy
can never surprise you with a migration.

### 4. Region

`vercel.json` pins functions to `hnd1` (Tokyo) because the Supabase project is
in `ap-northeast-1`. On Vercel's default region every query crosses the Pacific,
several times per page. If you move the Supabase project, change this to match.

### After the first deploy, check

- `/api/health` returns `{"status":"ok"}` — the Next app
- `/api/rectify` returns `{"status":"ok"}` — the Python function
- Sign in works and the session survives a reload
- A book cover loads (served from your bucket, not Open Library)
- An annotation lands where you draw it
- Adjusting page corners produces a straightened page
- Extraction produces a passage — the slowest path, and the one most likely to
  hit a free-tier rate limit

---

## Performance

The app talks to Supabase in Tokyo, so every avoidable round trip costs about
200–290 ms. Measured on a production build with a twelve-page book of 2 MB
photographs:

| | before | after |
| --- | --- | --- |
| `/library` | 1071 ms | 393 ms |
| `/books/[id]` | 1850 ms | 429 ms |
| page view | 2550 ms | 799 ms |
| book grid download | 24.17 MB | 0.19 MB |

What made the difference, in order of size:

- **Thumbnails.** `sharp` generates a 480 px JPEG at upload. CSS only changes
  how many pixels are painted, never how many are fetched.
- **Self-hosted covers.** Open Library's CDN takes 1.5–5 s; ours takes
  48–138 ms warm.
- **The connection pool.** `max: 1` meant `Promise.all` queued behind a single
  connection and bought nothing.
- **Local session verification.** The access token's signature is checked
  against the project's JWKS rather than by asking the auth server: 1 ms instead
  of 284 ms, three times per navigation.
- **Batched, cached signed URLs.** One request instead of one per image, and a
  stable URL so the browser's image cache can hit.
- **Image recovery at the image boundary.** Expired signed URLs renew on a
  failed image load, with in-flight renewals coalesced by storage key.
- **`loading.tsx` at every route**, so navigation paints immediately.

---

## Working under free-tier constraints

The interesting constraints, and what they forced.

- **Serverless has no background.** Vercel functions end when the response is
  sent; work started and not awaited is killed. This is why enrichment is a
  separate request rather than fire-and-forget after the annotation write.
- **Postgres connections.** Each invocation opens its own, so runtime traffic
  uses the transaction pooler (6543) while migrations need a session that
  outlives a statement (5432). Hence two connection strings.
- **Vision quota is per model and PER DAY, and small.** Measured on a real key,
  `gemini-3.5-flash` allows **20 requests a day**. The default is
  `gemini-3.5-flash-lite` for that reason, not for speed; on transcription
  quality the two were indistinguishable. Because quota is per model, switching
  `GEMINI_VISION_MODEL` grants a fresh allowance immediately.
- **429s are routine, not exceptional.** They are handled with backoff, and a
  rate limit does not consume the retry budget — so one bad afternoon cannot
  mark good annotations permanently failed.
- **Serverless caps how long you can wait.** In-request retries are three
  attempts a few hundred milliseconds apart, not a patient exponential backoff.
  Anything longer becomes a retry button.
- **Vercel meters optimised images.** Covers use a plain `<img>` rather than
  `next/image`; they are already small, and re-optimising spends quota for
  nothing.
- **Supabase pauses idle projects** after about a week. Worth knowing before a
  demo.
- **Supabase's built-in email sender is rate limited** and explicitly not for
  production. Either turn confirmation off or configure custom SMTP.
- **No `next/font`.** It downloads font files during the build, making the
  production build depend on network access to Google Fonts. A system font stack
  cannot fail.

---

## Build phases

| # | Phase | Status |
| --- | --- | --- |
| 1 | Scaffold, config, folder structure, docs | done |
| 2 | Supabase, schema, Drizzle migrations, scoped data access | done |
| 3 | Auth: sign up, sign in, protected routes, sessions | done |
| 4 | Books: Open Library search, create, library view | done |
| 5 | Pages: direct-to-storage upload, signed reads, page view | done |
| 6 | Canvas: normalized coordinates, pins, resize and zoom | done |
| 7 | Enrichment: provider interface, pending, backoff, retry | done |
| 8 | Full-text search with tsvector and GIN | done |
| 9 | Deploy to Vercel and verify end to end | done |
| 10 | Page-processor: rectify photographed pages with OpenCV | done |
| 11 | Reading view, manual transcripts, text annotations | done |
| 12 | Deletes, dashboards, search clarity, capture checks | done |
| 13 | Editable corners with annotation re-projection | done |
| 14 | Rectification deployed to production | done |
