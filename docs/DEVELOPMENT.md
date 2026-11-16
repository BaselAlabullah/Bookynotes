# Development and deployment

[Back to Bookynotes](../README.md)

Setup, checks, maintenance, and deployment reference. Run commands from the
repository root unless a command changes directory. See [`.env.example`](../.env.example)
for all configuration options and the [page processor guide](../page-processor/README.md)
for manual Python setup.

## Running locally

Requires Node 22+, a configured Supabase project, and an API key for the selected
vision provider. Python 3.11+ is needed for local page straightening. Set up the
database and storage below before starting the app.

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run db:migrate           # apply the schema to your configured database
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

Use the session pooler host (`aws-<n>-<region>.pooler.supabase.com`) for migrations.

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

The repository is configured for Vercel, with the Python rectifier in the same project.

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

Provider defaults: `VISION_PROVIDER` (`gemini`) and
`GEMINI_VISION_MODEL` (`gemini-3.5-flash-lite`). To use OpenRouter, set
`VISION_PROVIDER=openrouter` and `OPENROUTER_API_KEY`; optionally override
`OPENROUTER_VISION_MODEL`. The selected provider requires its API key even when
you plan to use manual transcripts.

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

