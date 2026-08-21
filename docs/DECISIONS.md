# Decisions

Append-only. One entry per real fork in the road: what the problem was, what the
options were, what we chose, and why. Entries are never edited after the fact —
if a decision is reversed, a later entry supersedes it and says so.

---

## 0001 — API routes inside Next, no separate backend

**Problem.** The app needs a server: signed URL issuing, database access, and
vision model calls all hold secrets and cannot run in the browser.

**Options.** (a) An Express service deployed separately. (b) Next.js route
handlers and server components inside the same project.

**Decision.** (b).

**Why.** Every free host for an always-on Node process either sleeps after
inactivity or requires a card. Vercel's free tier runs Next's server code as
serverless functions with no idle cost. The cost of this choice is that all
server code is request-scoped: there is no long-lived process, no in-memory
cache, and no background worker. That constraint shapes decision 0008.

---

## 0002 — Source layout is feature-first, not layer-first

**Problem.** Where does a file go?

**Options.** (a) Group by technical layer: `components/`, `hooks/`,
`services/`, `types/`. (b) Group by domain: `books/`, `pages/`,
`annotations/`.

**Decision.** (b), under `src/features/`, with every feature using the same
internal slots (`types`, `schema`, `repository`, `service`, `components`,
`hooks`).

**Why.** Layer-first means a single change touches five directories and no
directory tells you what the app does. Feature-first keeps a change local and
makes the domain readable from the tree. The uniform internal shape is what
stops feature-first from becoming a free-for-all — learning one feature teaches
you all of them.

---

## 0003 — Drizzle schema is central, queries are per-feature

**Problem.** Feature-first says the `books` table belongs in
`features/books/`. Migrations and relations say otherwise.

**Options.** (a) Table definitions inside each feature. (b) All table
definitions in `src/db/schema/`, one file per table.

**Decision.** (b), while queries stay in each feature's repository.

**Why.** Migrations are global, and relations cross domains — an annotation
joins pages joins books. One place to read the entire data model is worth
breaking the grouping rule for, especially when the point of the project is to
be explainable. The rule that survives is the important half: no SQL outside a
feature repository, and every repository function takes a `userId`, so scoping
is structural rather than something each route handler must remember.

---

## 0004 — Zod at every untyped boundary

**Problem.** Request bodies, `process.env`, and third-party JSON are all
`unknown` at runtime. With `any` banned, something has to narrow them.

**Options.** (a) Hand-written type guards. (b) Zod.

**Decision.** (b), and only at boundaries — never between two modules we own.

**Why.** Hand-written guards are more code to explain and drift from the types
they claim to check. Zod makes the validator and the type the same artifact.
Restricting it to boundaries stops it becoming a second type system layered on
top of TypeScript.

---

## 0005 — Tailwind v4, configured in CSS

**Problem.** Tailwind v4 moved theme configuration out of `tailwind.config.js`
and into `@theme` blocks in CSS.

**Options.** (a) Pin v3 for the larger body of existing documentation.
(b) Use v4 as published.

**Decision.** (b).

**Why.** One fewer config file, and the theme sits next to the stylesheet it
applies to. The cost is real: search results and tutorials still overwhelmingly
describe v3, so a v3 answer will not always work here.

---

## 0006 — Dependency versions are pinned exactly

**Problem.** `^16.3.1` lets a `npm install` months from now produce a different
tree than the one that was tested.

**Options.** (a) Caret ranges plus the lockfile. (b) Exact pins plus the
lockfile.

**Decision.** (b).

**Why.** The lockfile already pins the installed tree, but exact ranges in
`package.json` make the intent visible without reading a 10,000-line file, and
stop a stray `npm install <pkg>` from silently floating everything else. Updates
become a deliberate commit.

---

## 0007 — TypeScript 6.0.3, not 7.0

**Problem.** TypeScript 7.0 is the current `latest` on npm, but
`typescript-eslint` (which `eslint-config-next` depends on) refuses to load
against the 7.0 compiler API and aborts every lint run.

**Options.** (a) TypeScript 7 with linting disabled or running against a
side-by-side TypeScript 6 install. (b) TypeScript 6.0.3 for the whole toolchain.

**Decision.** (b).

**Why.** Two compiler versions in one project is exactly the kind of magic this
repo is meant to avoid, and a lint step that does not run is worse than an
older compiler. Revisit once typescript-eslint ships TS 7 support. ESLint is
pinned to 9.x for the same reason: no Next plugin declares support for 10 yet.

---

## 0008 — `user_id` on every table, including derivable ones

**Problem.** A page's owner is derivable by joining up to its book, and an
annotation's by joining twice. Storing `user_id` on all three duplicates it.

**Options.** (a) Normalise: `user_id` on `books` only, join to scope anything
else. (b) Denormalise: `user_id` on every table.

**Decision.** (b).

**Why.** Scoping is this app's only access control, so it has to be the easiest
thing in the codebase to get right and the easiest to audit. With `user_id`
present everywhere, every query filters on the table it is already reading, and
"is this query scoped?" is answerable by looking at one WHERE clause instead of
verifying a join chain. The cost is that inserts must set it consistently, which
is why creating a page or an annotation goes through a service that checks the
parent first.

---

## 0009 — Identifiers are branded types

**Problem.** Every id is a uuid, so at the type level `userId`, `bookId` and
`pageId` are all `string`. `findBook(bookId, userId)` with the arguments the
wrong way round compiles fine and returns nothing, forever.

**Options.** (a) Naming discipline. (b) Branded types: `string` plus a phantom
property that exists only at compile time.

**Decision.** (b), in `src/db/ids.ts`, applied to columns with Drizzle's
`.$type<...>()` so the brands flow outward through inferred row types.

**Why.** The mistake being prevented is a silent one — no crash, no error, just
an empty result or, worse, a row attached to the wrong user. Zero runtime cost
and no output. The price is a cast at each boundary where an untrusted string
becomes an id, which is exactly where a `z.uuid()` check should be anyway.

---

## 0010 — Foreign keys to `auth.users` live in a hand-written migration

**Problem.** We want `ON DELETE CASCADE` from `auth.users`, so deleting an
account removes its library by database action rather than by remembering to.
But declaring `auth.users` in the Drizzle schema makes drizzle-kit generate
`CREATE SCHEMA "auth"` and `CREATE TABLE auth.users` — both of which fail
against a real Supabase database, which already owns them. `schemaFilter:
["public"]` does not suppress this; it was tried.

**Options.** (a) Drop the foreign keys and let orphan rows exist. (b) Keep the
generated migration free of `auth`, and add the constraints in a custom
migration (`drizzle-kit generate --custom`).

**Decision.** (b).

**Why.** Referential integrity for account deletion is worth one hand-written
file, and the custom migration is registered in drizzle's journal like any
other, so it runs in order and only once. The cost is real and is written at
the top of that file: `drizzle-kit push` diffs against the live database and
would drop these constraints, because the schema files do not mention them.
This project uses `generate` + `migrate` only.

---

## 0011 — Row level security is on, with no policies

**Problem.** Scoping is enforced in application code. If that code has a bug,
nothing else stops a cross-user read.

**Options.** (a) Leave RLS off, since Drizzle connects with a role that bypasses
it anyway. (b) Enable RLS on every table and write policies mirroring the
application's scoping. (c) Enable RLS on every table and write no policies at
all.

**Decision.** (c).

**Why.** RLS with no policies denies everything by default. That is exactly
right for the paths we do not intend anyone to use: the Supabase anon key is
shipped to the browser, and without this, anyone holding it could read every
table over Supabase's REST endpoint. Option (b) sounds safer but means the same
rule written twice in two languages, which drift apart. Option (a) leaves the
public REST endpoint wide open.

Assumption to verify in phase 3: the pooled connection string's role has
BYPASSRLS. If it does not, our very first query returns zero rows and we will
know immediately.

---

## 0012 — Missing and forbidden are the same answer

**Problem.** What should a repository return when a row does not exist, versus
when it exists but belongs to another user?

**Options.** (a) `null` for missing, throw `ForbiddenError` for the other.
(b) `null` for both.

**Decision.** (b).

**Why.** Telling the two apart tells a stranger which ids are real, which is
enough to enumerate the size of someone's library. It also avoids inventing an
exception hierarchy in phase 2 that nothing yet needs — route handlers map
`null` to 404 and there is nothing to catch. If a case later genuinely needs the
distinction internally, it gets a differently named function rather than a
different failure mode.

---

## 0013 — Confirming the assumptions in 0002 and 0011 against the live database

Not a fork, a receipt. The first migration ran against the real Supabase project
on 2026-08-19, and the two things earlier entries recorded as unverified are now
verified:

- **0011's BYPASSRLS assumption holds.** The pooled connection authenticates as
  role `postgres` with `rolbypassrls = true` (and, worth noting, `rolsuper =
  false` — Supabase does not hand out superuser). So RLS is enabled on all three
  tables with zero policies, denying every path that is not ours, while the
  application's own scoping continues to work.
- **The generated `tsvector` column was accepted.** Postgres resolved
  `to_tsvector('english', …)` to the immutable `to_tsvector(regconfig, text)`
  form, so the STORED generated column and its GIN index both exist.

Also confirmed present: the three `ON DELETE CASCADE` foreign keys into
`auth.users` from the hand-written migration 0001, the seven check constraints,
and the `(book_id, page_number)` unique constraint.

---

## 0014 — Auth uses Server Functions, not route handlers plus fetch

**Problem.** The credential forms need to reach the server.

**Options.** (a) `POST /api/auth/sign-in` with a client-side `fetch`, JSON in and
JSON out. (b) Server Functions passed straight to a form's `action`.

**Decision.** (b).

**Why.** The form posts directly to the function: no fetch, no JSON envelope, no
client-side state machine, and the form still works if the JavaScript bundle
fails to load. `useActionState` gives the pending and error states for free.

The cost is real and shapes decision 0016: a Server Function is not a route. It
is a POST to whichever route rendered it, so it can move out from under a
protected path without anything visibly changing.

---

## 0015 — `getUser()`, never `getSession()`

**Problem.** Supabase offers two ways to read the current session on the server.

**Options.** (a) `getSession()` — decodes the cookie locally. Fast, no network.
(b) `getUser()` — sends the token to Supabase's auth server, which verifies the
signature and that the user still exists. One network call per request.

**Decision.** (b), everywhere, with no exception for "read-only" paths.

**Why.** The cookie is data supplied by whoever is making the request. Trusting
its contents without verification is an authentication bypass, not a performance
optimisation. The latency is real and is the correct price.

---

## 0016 — Authorization lives in `requireUser()`, not in the proxy

**Problem.** Where do we stop an unauthenticated request?

**Options.** (a) In `src/proxy.ts`, by matching protected paths — the pattern
most Next tutorials show. (b) In a layout for the protected route group.
(c) In a `requireUser()` call at the top of every protected page and Server
Function.

**Decision.** (c), with (b) as a convenience on top. The proxy does no
authorization at all; its only job is refreshing the session cookie.

**Why.** Next's documentation is explicit that Server Functions are POSTs to the
route that rendered them, so a matcher edit or a component move can drop them
out of a proxy's coverage with no error and no visible change. Path matching also
fails open: forget to list a path and it is public. `requireUser()` fails closed
and sits next to the data access it guards. This is also why the library page
calls it even though its layout already did — the page's guarantee should not
depend on where it sits in the tree.

---

## 0017 — The session cookie is httpOnly

**Problem.** `@supabase/ssr` writes the auth cookie readable by JavaScript,
because its browser client reads the session from `document.cookie`. Any XSS bug
could then exfiltrate an access token and a refresh token.

**Options.** (a) Leave the library default and keep the option of a browser
client. (b) Override the cookie options to `httpOnly`, giving up the browser
client entirely.

**Decision.** (b), in `features/auth/session-cookie.ts`, applied in both places
we write cookies. Verified against a running server: the response carries
`Secure; HttpOnly; SameSite=lax`.

**Why.** Every Supabase Auth call in this app happens in a Server Function or a
route handler, so nothing needs to read the session in the browser. Given that,
leaving a refresh token exposed to script buys nothing.

The consequence, stated so it is not discovered by surprise: `createBrowserClient()`
will not see a session anywhere in this app. Phase 5 does not need one (uploads
use a signed URL and a plain `fetch`) and neither does phase 7 (the client polls
our own API). If a later phase genuinely does, reverting is one file — and it is
a security trade-off, not a config tweak.

---

## 0018 — Verifying phase 3 against a running server

Not a fork, a receipt. Auth was tested end to end on 2026-08-19 against the
production build and the live Supabase project, using a seeded user that was
deleted afterwards:

- `GET /library` with no session gave `307` to `/sign-in`.
- Signing in through the real `createSupabaseServerClient()` set the session
  cookie, after which `GET /library` gave `200` and rendered the user's email.
- `GET /sign-in` while signed in gave `307` to `/library`.
- A wrong password gave `Invalid login credentials`, which does not reveal
  whether the account exists.
- Deleting the user removed their book with no application code involved,
  confirming the `ON DELETE CASCADE` from decision 0010.

Two things this caught that a passing build could not: a stale dev server on port
3000 still serving an old bundle, and Next's private-folder convention silently
excluding any route directory whose name begins with an underscore.

---

## 0019 — `/auth/confirm` handles both confirmation link styles

**Problem.** Phase 3 shipped a confirmation handler that only understood
`?token_hash=...&type=...`. Supabase's *default* email template does not send
that: its link goes to Supabase's own `/auth/v1/verify`, which confirms the
account and then redirects back with a PKCE `?code=...` to exchange. The account
was being confirmed, but the user was bounced to `/sign-in` with an error the
sign-in page did not even render.

**Options.** (a) Require the custom email template and document it. (b) Handle
`code` only, and drop the token_hash path. (c) Handle both.

**Decision.** (c), plus rendering the error on the sign-in page.

**Why.** Which style arrives depends on a dashboard setting this code cannot
read, and getting it wrong is silent — the account works, the user just cannot
tell. Supporting both costs about fifteen lines and removes a class of "it
didn't work and I don't know why".

Two details worth keeping:

- The failure codes travel in the query string as **codes**, mapped to sentences
  in `features/auth/auth.errors.ts`. Putting the message itself in the URL would
  let anyone paint arbitrary text onto our own sign-in page — "your session
  expired, re-enter your password" is a convincing thing to be able to render.
- A failed exchange mentioning the code verifier gets its own message. PKCE
  stores the verifier in a cookie at sign-up, so opening the email on a
  different device is a distinct failure from an expired link, and telling
  someone their link expired when it did not sends them round in a circle.

---

## 0020 — Search is a route handler; adding a book is a Server Function

**Problem.** Phase 3 chose Server Functions for auth (0014). Does everything now
become a Server Function?

**Options.** (a) Both operations as Server Functions. (b) Both as route handlers
plus client fetch. (c) Split by what the operation is.

**Decision.** (c). `POST` to add a book is a Server Function; `GET
/api/books/search` is a route handler.

**Why.** Server Functions are POSTs, and React serialises them one at a time per
client. That is exactly right for a mutation — it stops double submits for free
— and exactly wrong for a search that fires while the user is still typing,
where requests need to overlap and be cancellable. Adding a book is also a form
submission that should work without JavaScript; search inherently cannot.

The rule that falls out: mutations from a form are Server Functions, reads that
need cancellation or concurrency are route handlers.

---

## 0021 — Open Library's optional fields are handled, not assumed away

**Problem.** `author_name` and `cover_i` are absent from a large fraction of
Open Library works, and the occasional record is unusable entirely.

**Options.** (a) Require the fields in the schema and let a search throw.
(b) Mark them optional and validate the whole response as one unit. (c) Mark
them optional and validate each record separately, dropping the ones that fail.

**Decision.** (c). `docs` is parsed as `unknown[]`, then each entry is validated
on its own and skipped if invalid.

**Why.** With (a) or (b), one malformed record in a list of ten means the user's
search for a real book fails with a validation error they can do nothing about.
A third party's data quality should cost a result, not the request.

A related consequence: `books.author` is NOT NULL, and an absent author becomes
the literal string "Unknown author" rather than making the column nullable. The
absence is a display concern, and a nullable column would push that concern into
every query and every template downstream.

---

## 0022 — Book covers use a plain `<img>`, not `next/image`

**Problem.** `next/image` is the default answer and the linter asks for it.

**Options.** (a) `next/image` with `covers.openlibrary.org` in
`images.remotePatterns`. (b) A plain `<img>` with an explicit lint exemption.

**Decision.** (b).

**Why.** Vercel's free tier meters optimised images. These covers are already
about 180px wide, already served from Open Library's CDN, and never rendered in
bulk above the fold. Spending a metered quota to re-optimise somebody else's
correctly sized thumbnail is a bad trade on a zero-cost project. The lint rule is
disabled on exactly one line, with the reasoning in the component's doc comment.

---

## 0023 — The search endpoint requires a session

**Problem.** `/api/books/search` exposes no user data. Does it need auth?

**Options.** (a) Leave it public — it is a proxy to a public API. (b) Require a
session.

**Decision.** (b), returning `401` rather than redirecting.

**Why.** A public endpoint here is an open proxy: anyone could point a script at
it and spend our Open Library goodwill, and the next thing we would have to build
is IP rate limiting. Requiring a session makes abuse cost an account.

It returns `401` instead of calling `requireUser()` because a redirect is a
nonsense answer to a `fetch` — the caller gets an HTML sign-in page where it
expected JSON. This is why `auth.session.ts` exposes `getCurrentUser` alongside
`requireUser`.

---

## 0024 — Verifying phase 4 against a running server

Not a fork, a receipt. Tested on 2026-08-19 against the production build, the
live Supabase project and the live Open Library API, with two seeded users
deleted afterwards:

- `GET /api/books/search` with no session gave `401`.
- With a session, "piranesi susanna clarke" returned the real work
  `OL20893680W` with cover and edition count.
- A one-character query gave `400` with the validation message.
- Adding that result wrote the book and `/library` rendered its title, author
  and cover.
- A bogus `openLibraryId` was rejected by the Server Function, proving hidden
  form inputs are re-validated rather than trusted.
- **A second signed-in user saw an empty library while the book existed in the
  table.** This is the user scoping from decisions 0002 and 0008 demonstrated
  end to end, and it is the property everything else rests on.
- Deleting the users removed the book by cascade.

One thing the linter caught that is worth keeping: React's
`react-hooks/set-state-in-effect` flagged the search effect clearing results for
a too-short query. That was a genuine "you might not need an effect" — whether
results are worth showing is derived from the query, not state to be kept in
sync with it. The effect now does one thing: talk to the network.

---

## 0025 — Uploads are two requests, and the row is written last

**Problem.** The browser uploads directly to Supabase, so the app server never
sees the bytes and cannot know whether the upload worked. When does the `pages`
row get written?

**Options.** (a) Write the row first, hand back a signed URL, and let the client
upload afterwards. (b) Hand back a signed URL, let the client upload, then have
the client confirm and write the row.

**Decision.** (b). `prepareUpload` writes nothing; `completeUpload` checks the
object is really in the bucket, then inserts.

**Why.** The two failure modes are not equal. With (a), an abandoned upload
leaves a page row pointing at nothing, and every reader downstream has to cope
with a page that cannot be displayed — a database that lies. With (b), the same
abandonment leaves an unreferenced object in a bucket: invisible, harmless, and
cheap to sweep. A `pages` row always means an image exists.

`objectExists` before the insert is what makes that guarantee real. Without it,
"the upload succeeded" would be the browser's unverified word.

---

## 0026 — The storage key starts with the owner's id

**Problem.** In step two the client tells us "the file is at this path". That
string is user input, and it decides which object a page row points at.

**Options.** (a) Look the path up and check whoever owns it. (b) Make every key
begin with `<userId>/<bookId>/` and reject anything that does not match.

**Decision.** (b), in `pages.storage-key.ts`, checked in `completeUpload`.

**Why.** Without the check, a signed-in user could point a page row of their own
at another user's object and read it through our own signed-URL endpoint. With
the prefix baked into the key, rejecting that is a string comparison against
values we already trust, rather than a lookup that could be written wrong.

The filename itself is random rather than derived from the page number, because
page numbers get corrected and an object that has to be renamed when a row is
edited eventually disagrees with its row.

---

## 0027 — Read URLs are signed per render and never stored

**Problem.** The bucket is private, so every image needs a signed URL. Where
does it come from?

**Options.** (a) Sign long-lived URLs and store them on the page row. (b) Sign
short-lived URLs at render time, every time.

**Decision.** (b), five minutes, signed in parallel for a book's pages.

**Why.** A stored URL is a durable public link to a private object: it works for
anyone who obtains it, for as long as it lives, with no further authorization.
Signing at render time means access is re-checked on every view by the code that
already knows who is asking. This is also why `pages.storage_key` holds a path
and not a URL — storing a URL would mean storing something that stops working.

The signing is done with `Promise.all` and a failure for one page is swallowed
into a "preview unavailable" tile, so one bad object costs one thumbnail rather
than the whole book.

---

## 0028 — Image dimensions are reported by the browser

**Problem.** Every annotation coordinate is a fraction of the page image's
intrinsic size, so those two numbers matter more than anything else stored about
a page. They are measured in the browser with `createImageBitmap` and sent to
us.

**Options.** (a) Verify server-side by downloading the object and reading its
header. (b) Accept the client's numbers.

**Decision.** (b), with positive-integer bounds in zod and `> 0` check
constraints in Postgres.

**Why.** Verifying means pulling the bytes through the app server, which undoes
the entire reason for direct-to-storage upload and costs serverless execution
time on a free tier. The blast radius of a lie is contained: wrong dimensions
distort only that user's own annotations on their own page. Nobody else is
affected, and no security property depends on the values.

This is the weakest link in the coordinate design and is written down here so it
is a known trade rather than a discovered surprise.

---

## 0029 — Duplicate page numbers are caught by the constraint, not a pre-check

**Problem.** `(book_id, page_number)` is unique. What happens when someone
uploads page 12 twice?

**Options.** (a) Query for an existing page first and refuse if found.
(b) Attempt the insert and handle the `23505` unique violation.

**Decision.** (b), in `pages.service.ts`, with the orphaned object removed on
the way out.

**Why.** A read-then-write check races: two uploads in flight at once both read
"no page 12" and both proceed. The constraint cannot be raced, because the
database decides. `db/errors.ts` exists to tell that expected outcome apart from
a genuine failure, so a duplicate becomes a sentence the user can act on rather
than a 500.

---

## 0030 — Verifying phase 5, and the two bugs it found

Not a fork, a receipt. The upload flow was run end to end on 2026-08-19 against
the production build, the live Supabase project and the real `page-images`
bucket, with a seeded user deleted afterwards:

- Signed upload URL issued, file PUT **directly to Supabase**, page row written:
  `201`.
- Uploading page 12 twice: `409 "Page 12 already exists in this book."`
- Confirming a key that was never uploaded: `409 "That upload did not finish."`
- The page view rendered a signed `<img>` whose URL served real image bytes.
- The **same object without its signature: `400`.** The bucket is genuinely
  private; the signature is doing the work.
- The orphan sweep was verified directly rather than inferred: two objects
  existed immediately after the duplicate's upload, one object and one page row
  remained after its confirm was rejected.

Two real bugs, neither of which a passing build or a type check would have
found:

**Drizzle wraps driver errors.** `isUniqueViolation` looked at `error.code`, but
Drizzle raises a `DrizzleQueryError` carrying the SQL and parameters and hangs
the driver's error off `.cause`. The code was `undefined` at the top level, so
every constraint violation fell through as a 500 with an empty body instead of a
409. It now walks the cause chain to a bounded depth.

**A missing object is an answer, not a failure.** Supabase's `exists()` returns
`data: false` *with* an error attached, because the underlying HEAD answers 400.
Treating any error as a failure turned "that upload did not finish" into
"storage is not responding" — telling the user to wait when they should retry.
`objectExists` now distinguishes a 400/404 from a real outage.

Both bugs lived on the error paths, which is exactly where a happy-path demo
never looks.

### A known gap, recorded rather than fixed

Deleting a page row does not delete its object. `ON DELETE CASCADE` governs rows
in Postgres and knows nothing about a bucket, so removing a page — or a book, or
a user — leaves its images behind. There is no delete UI yet, so nothing
triggers it today. When one is added, deletion has to remove the object first
and the row second, so a failure leaves a recoverable orphan rather than a row
pointing at nothing.

---

## 0031 — The SVG viewBox is the unit square

**Problem.** Annotations are stored as fractions of the page image's intrinsic
size. Something has to turn those fractions into pixels on screen, and get it
right again on every resize and at every zoom level.

**Options.** (a) Absolutely positioned HTML boxes, with a `ResizeObserver`
measuring the image and recomputing pixel offsets on every change. (b) A canvas
element, redrawn on resize. (c) An SVG overlay whose `viewBox` is `0 0 1 1`.

**Decision.** (c).

**Why.** With a unit-square viewBox, the stored numbers *are* the SVG's
coordinate system. A rectangle of `{x: 0.2, y: 0.5, width: 0.3, height: 0.04}`
is written into the element unchanged, and this was verified from the outside:
the rendered DOM contains `<rect x="0.2" y="0.5" width="0.3" height="0.04">`.

The consequences are the whole argument:

- Resizing re-projects every pin, and the browser does it. There is no
  `ResizeObserver` in this codebase and no re-render on resize, because there is
  nothing to recompute.
- Zoom is the same story, which is why decision 0032 could be so cheap.
- There is no projection code on the render path, so there is no projection code
  on the render path to get wrong. The only screen-to-image conversion left is
  the pointer handler, and it is four lines.

`preserveAspectRatio="none"` is required and deliberate: x and y must scale
independently, because a normalized x is a fraction of the width and a
normalized y is a fraction of the height — different numbers of pixels.

`vector-effect="non-scaling-stroke"` is what keeps outlines visible: a stroke
width expressed in unit-square coordinates would be about half the page wide.

---

## 0032 — Zoom is container width; panning is the browser's

**Problem.** The page needs to zoom, and a zoomed page needs panning. Both have
to leave annotation coordinates correct.

**Options.** (a) A CSS `transform: scale()` with a pan offset, tracking the
transform matrix and inverting it for pointer maths. (b) Widen the container and
let the container's own scrollbars do the panning.

**Decision.** (b). Zoom sets `width: ${zoom * 100}%` on a wrapper; the scroll
container handles the rest.

**Why.** Option (a) means owning a transform matrix and inverting it correctly
on every pointer event — the classic source of "the pin lands slightly off when
zoomed". Option (b) has no matrix at all: `getBoundingClientRect()` already
reports the painted box, so dividing by it is correct at any zoom and any scroll
offset. The pointer handler does not know the zoom level and does not need to.

It is also better behaviour for free — momentum scrolling, keyboard scrolling,
scrollbars, and touch panning all come from the platform.

---

## 0033 — Shapes are SVG, labels are HTML

**Problem.** `preserveAspectRatio="none"` scales x and y by different factors.
That is right for rectangles and wrong for text: glyphs would be visibly
stretched.

**Options.** (a) SVG `<text>` inside the overlay, corrected with a counter
transform. (b) Absolutely positioned HTML labels using percentage offsets.

**Decision.** (b).

**Why.** A percentage offset uses exactly the same normalized number the
rectangle does — `left: ${x * 100}%` — so nothing is measured and nothing can
drift out of alignment. Text stays upright and legible at any zoom. The counter
transform in (a) would be more code to achieve less.

---

## 0034 — The annotation form is not progressively enhanced

**Problem.** Decision 0014 chose Server Functions partly so forms work without
JavaScript. `createAnnotationAction` takes a typed object and is called from
client code instead, which gives that up.

**Options.** (a) Keep the `FormData` shape and hidden inputs for consistency.
(b) Call the Server Function directly with a typed argument.

**Decision.** (b).

**Why.** There is nothing to enhance from. The input is a rectangle dragged with
a pointer; without JavaScript there is no rectangle. Keeping the form shape
would be a ritual rather than a capability. Calling directly also lets the draft
rectangle be cleared only after the write has actually succeeded, so a failure
leaves the user's selection intact instead of making them draw it again.

The argument is still parsed with Zod. A Server Function's parameters are
deserialised from a request body, so a TypeScript type on them is a description,
not a guarantee.

---

## 0035 — Verifying phase 6

Not a fork, a receipt. Run on 2026-08-19 against the production build and the
live project, with seeded users deleted afterwards:

- An annotation created with `{x: 0.2, y: 0.5, width: 0.3, height: 0.04}` was
  stored with those exact values — not rounded, not scaled.
- The rendered page contained `viewBox="0 0 1 1"` and
  `<rect x="0.2" y="0.5" width="0.3" height="0.04">`. **The stored value reaches
  the DOM unchanged**, which is the claim decision 0031 is making.
- No two-or-more digit coordinate appears anywhere in the overlay, so no pixel
  value leaked into it.
- The annotation was born `enrichment_status = 'pending'` with `retry_count = 0`
  — the write did not wait on anything.
- Rejected, each with its own message: **pixel values** (`expected number to be
  <=1`), a rectangle past the right edge, zero width, and a negative origin.
- Annotating another user's page returned "That page could not be found" — the
  same answer as a page that does not exist.

The pixel-value case is the one worth keeping. If a raw pixel coordinate ever
reaches the boundary through some future bug, it is thousands of times larger
than 1 and is refused loudly, rather than being stored and rendering a pin in an
absurd place.

---

## 0036 — 1x zoom means the whole page, not the column width

**Problem.** Decision 0032 made zoom set the wrapper's width, with 1x meaning
"as wide as the column". Book pages are portrait, so on a real page that put
about half the page below the fold at the default zoom, with no way to zoom out
— 1x was the floor. Reported from an actual screenshot, not from a test.

**Options.** (a) Add fractional steps below 1 (0.5, 0.75). (b) Redefine 1x as
"the whole page fits", so there is nothing useful below it.

**Decision.** (b). The wrapper keeps `width: zoom * 100%` and gains a
`max-width` equal to the width at which the page is exactly `78vh * zoom` tall.
Whichever limit binds first wins, so a portrait page is height-limited and a
landscape spread is width-limited, and both fit at 1x.

**Why.** Fractional steps would have left the same bad default one click away
from the user, and "0.75x" means nothing to a reader — "the whole page" does.

The part worth keeping is how the limit is computed. The aspect ratio comes from
`image_width` and `image_height`, which are stored on the row and known before
the image has even loaded, so the whole thing is one CSS `calc()` and nothing is
measured from the DOM. The overlay stays aligned for the same reason it always
did: the wrapper is still exactly the image's box.

Verified on both shapes at a nominal 1000x900 viewport: a 1240x1754 page renders
496x702 (height-limited), a 3024x1400 spread renders 1000x463 (width-limited),
and the overlay stays pinned to the image box in both.

---

## 0037 — The vision provider is an interface with two real implementations

**Problem.** The app needs a vision model, on a free tier, without being welded
to one vendor.

**Options.** (a) Call Gemini directly from the enrichment code. (b) Define a
`VisionProvider` interface and write one implementation. (c) Define the
interface and write two, selected by environment variable.

**Decision.** (c). Gemini Flash is the default, OpenRouter is the fallback, and
`VISION_PROVIDER` chooses.

**Why.** An interface with a single implementation is a guess about what varies;
the second one is what proves the seam is in the right place. It also turned out
to be informative: Gemini takes `inline_data` with a response schema, OpenRouter
takes OpenAI-shaped `image_url` content parts with a loose `json_object` hint.
Those differences are exactly what the interface exists to hide, and neither
would have been visible with one provider.

Both are called with plain `fetch` rather than a vendor SDK. Each is one POST,
and keeping the wire format in the file is what makes a free-tier 429 debuggable
instead of a mystery inside a client library.

---

## 0038 — Failures are classified by what to do, not by what went wrong

**Problem.** A vision call can fail because the quota is gone, because the
network blipped, or because the API key is wrong. Retrying is right for one of
those, pointless for another, and actively harmful for the third.

**Options.** (a) One error type, retry everything N times. (b) Three error
types: rate limited, transient, permanent.

**Decision.** (b), in `vision.types.ts`, with the retry policy in
`vision.client.ts` reading only that classification.

**Why.** Retrying a bad API key three times spends the budget that a genuine
blip needs, and takes three times as long to tell the user something that will
never work. The verification bore this out: an invalid key produced one failed
attempt and a terminal state, not three.

Two policy details that follow from running on serverless:

- **In-request retries are deliberately few and short** (three attempts, a few
  hundred milliseconds apart, jittered). A long backoff cannot survive a
  function's wall-clock limit — it would be killed mid-wait and the user would
  see nothing at all. Persistent failure is handled by ending the request and
  leaving the row retryable.
- **A rate limit longer than a few seconds is not waited out.** Free tiers
  routinely answer "come back in 60 seconds"; a retry button beats holding a
  function open for a minute.

Rate limits also do not consume the attempt budget. A quota wall is not the
annotation's fault, and letting it count would mark perfectly good annotations
permanently failed after one bad afternoon.

---

## 0039 — Enrichment is the one place image bytes pass through this server

**Problem.** Phase 5 established that image bytes never transit the app server.
The vision model needs pixels.

**Options.** (a) Have the browser crop the region and post it, keeping the
server out of the way. (b) Have the server fetch the page, crop it, and send it.

**Decision.** (b), and DECISIONS 0025's rule now has a stated exception.

**Why.** With (a) the model's input is whatever the client chose to send, and
"what did we actually ask the model?" stops being answerable from the server. It
would also make enrichment impossible from anywhere the image is not already
loaded. The cost is real — an extra fetch, and `sharp` as a native dependency —
and it is confined to this one path.

What gets sent is not the raw photograph:

- **A padded crop.** The whole page wastes tokens and makes the model hunt; the
  bare selection removes the surrounding lines that "context" is meant to
  describe.
- **With the user's rectangle drawn on it.** Because the crop is padded, "which
  part did the reader mean?" would otherwise be ambiguous. Drawing the box shows
  the model the region instead of describing coordinates it has to resolve.
- **Grayscaled and contrast-normalised.** A phone photo of paper is unevenly
  lit. This is the "make it look scanned" step, applied to the model's input
  rather than to anything we keep.
- **Downscaled to 1400px.** Past the point where letters are sharp, resolution
  is only cost.

One detail worth keeping: the crop is computed against the dimensions `sharp`
decodes, not the ones stored on the page row. Those were reported by the browser
(DECISIONS 0028) and cannot be verified — but because the rectangle is a
*fraction*, multiplying by the true decoded size is correct whatever the row
claims. A client that lied about dimensions still gets the right crop.

---

## 0040 — "Scan view" is a display filter, not a regenerated page

**Problem.** Photographs of book pages are dim, warped and unevenly lit. The
suggestion was to have an LLM return a cleaned, scanned-looking version of the
page and use that instead.

**Options.** (a) Send the photo to an image model and store the cleaned result
as the page. (b) A CSS filter over the original for display, plus the same
cleanup applied to the model's input.

**Decision.** (b).

**Why.** (a) breaks two things at once. An image model *redraws* rather than
cleans, so on a page of prose it will silently alter words — fatal for an app
whose purpose is recording what a book actually says. And a regenerated image
has different geometry: dewarped, recropped, reframed. Every annotation
coordinate anchored to the original photograph would then point somewhere else,
which is the one invariant the entire project is built on.

(b) gets the legibility without either cost. `filter: grayscale(1) contrast(1.4)`
changes no pixel geometry, so coordinates stay valid, and it is free and
instant. The same treatment is applied to the crop the model sees, where it
genuinely improves transcription.

True perspective de-warping remains possible, but it would have to happen at
upload time, before any annotation exists, and the rectified image would become
the canonical one. That is a different feature, not a filter.

---

## 0041 — Verifying phase 7

Not a fork, a receipt. Run on 2026-08-19 against the production build, the live
project, and a synthetic page photograph with uneven lighting, using a
deliberately invalid API key so the failure paths were exercised for real:

- The prepared crop was **868 x 236** for a selection 61px tall — padded on all
  sides as intended, grayscaled, contrast-normalised, and carrying the user's
  rectangle drawn in red. Inspected as an image, not just asserted: the warm
  gradient was gone, the neighbouring lines were legible, and the marked line
  was unmistakable.
- An invalid key produced **one** attempt and a terminal `failed`, not three —
  the permanent/transient split doing its job.
- The user's retry reset the attempt budget rather than continuing it.
- An annotation already `complete` returned `cached` **without calling the
  model**. This is the cache that makes a free tier survivable.
- No session: `401`. Unknown or another user's annotation: `404`.

Untested until a real API key is present: the success path, and the quality of
what the model returns.

---

## 0042 — The Gemini model is configurable, and pinned rather than an alias

**Problem.** The provider hardcoded `gemini-2.0-flash`. On a freshly created API
key that model does not exist, so every extraction failed with a 404 — found
only by calling the real API with a real key.

Worse, the obvious replacement was also wrong. `gemini-2.5-flash` is still
*listed* by the models endpoint but refuses new keys: "no longer available to new
users". A model being listed is not the same as a model you can call.

**Options.** (a) Hardcode a newer model. (b) Use the `gemini-flash-latest`
alias. (c) Make it an environment variable with a pinned default.

**Decision.** (c). `GEMINI_VISION_MODEL`, defaulting to `gemini-3.5-flash`, and
`OPENROUTER_VISION_MODEL` already worked this way.

**Why.** (a) is the bug we just had, one model generation later. (b) looks
attractive and is worse than it sounds: measured, `gemini-flash-latest` answered
`503 "experiencing high demand"` while pinned models answered fine, and an alias
means the thing transcribing your books can change overnight with no commit and
no way to reproduce an old result.

The default was chosen by measurement, not by version number. Three trivial
requests each:

```
gemini-3.5-flash    2152ms  1785ms  1664ms
gemini-3.6-flash    6505ms  2087ms  11794ms
```

3.6 is newer and was Google's own suggested replacement in the 404 message, but
it was between two and seven times slower and far less consistent. For a
free-tier OCR call sitting in front of a spinner, predictable latency wins.

The general lesson, worth keeping for phase 9: model availability is per-account
and changes over time. Anything that names a model belongs in configuration.

---

## 0043 — Phase 7 verified against the live model

Not a fork, a receipt. Run on 2026-08-19 with a real API key, against a
synthetic page of prose with deliberately uneven lighting, so the transcription
could be checked word for word rather than merely being non-empty.

Selection: one full line of twelve, marked with a rectangle.

```
expected : "It was said in the taverns that the sea had learned to match him."
passage  : "It was said in the taverns that the sea had learned to match him."
exact match: true      word overlap: 14/14      status: complete      retries: 0
```

The context field was the more interesting result:

> "The passage is preceded by a sentence mentioning inventions that remarkably
> arrived where they intended, and followed by a sentence introducing Anselm the
> younger, who inherited a workshop and debts."

Both neighbours are correctly identified, which is direct evidence that the
padding in `annotations.crop.ts` is doing its job — an unpadded crop could not
have produced that, and a whole-page image would not have known which line was
meant.

Timings: 6.5s for the whole request (signed URL, image fetch, crop, model,
write). A second call on the same annotation returned `cached` in 925ms without
touching the model.

---

## 0044 — Search is a GET form and a server component

**Problem.** How does a search query reach the server?

**Options.** (a) A route handler plus a client fetch, as phase 4's Open Library
search does. (b) A plain `<form method="get">` pointing at `/search`, with the
page reading `?q=`.

**Decision.** (b). No `"use client"` anywhere in the search feature.

**Why.** The two searches look alike and are not. Open Library search fires
while the user types and needs overlapping, cancellable requests, so it had to
be a route handler (DECISIONS 0020). This one is submit-driven, and making the
query part of the URL hands us three things without writing them: results are
shareable and bookmarkable, the back button works, and the whole feature
functions with JavaScript disabled.

It also makes the page a pure function of its URL, which is the easiest kind of
page to reason about and to test — the verification simply fetched
`/search?q=sea` and read the HTML.

---

## 0045 — A read may join across domains; a write may not

**Problem.** DECISIONS 0003 says a repository touches only its own tables. A
search result is an annotation, plus the page it sits on, plus the book that
page belongs to. Search has no table of its own.

**Options.** (a) Query annotations, then fetch pages, then fetch books through
their own repositories and stitch the results together in JavaScript.
(b) Let `search.repository.ts` join all three.

**Decision.** (b), with the rule restated rather than abandoned: **reads may
cross domains, writes may not.**

**Why.** Option (a) is three round trips and a manual join to satisfy a layering
rule, in exchange for nothing — it is dogma at the cost of the single query
Postgres exists to answer. The part of the rule that was actually protecting
something still holds: nothing writes through this file, and `user_id` is in the
WHERE clause exactly as it is everywhere else.

The joins are inner, not left. Every annotation has a page and every page has a
book, enforced by foreign keys, so a left join could only serve to hide a broken
relationship that cannot happen.

---

## 0046 — `websearch_to_tsquery`, and highlights that are not HTML

**Problem.** Turning a typed string into a `tsquery`, and showing the user where
the match was.

**Options for the query.** (a) `plain_to_tsquery`. (b) `websearch_to_tsquery`.

**Decision.** (b).

**Why.** Readers already know how search boxes behave: quoted phrases stay
together, `or` broadens, a leading `-` excludes. All three were verified working.
The decisive reason is different though — `plain_to_tsquery` raises a syntax
error on a stray operator, which turns somebody's typo into a 500.
`websearch_to_tsquery` never throws.

**Options for highlighting.** (a) `ts_headline` with `StartSel=<mark>`, rendered
via `dangerouslySetInnerHTML`. (b) `ts_headline` with control characters as
delimiters, split in React into real elements.

**Decision.** (b).

**Why.** (a) means handing a user's own note and a language model's output to an
HTML parser, and reaching for the escape hatch React deliberately made ugly.
Control characters cost one `split()` and cannot occur in a book passage, so
splitting on them can never cut real text in half. Verified: three `<mark>`
elements rendered, zero control characters reaching the browser.

---

## 0047 — Verifying phase 8

Not a fork, a receipt. Run on 2026-08-19 against the production build and the
live database, with three annotations placing the word "sea" in a different
field each, plus a second user whose annotation was stuffed with the term.

**The weights from phase 2 work.** Ranking `sea` across the three:

```
1.40000   "the sea learned to match him"      'sea' in the comment  -> weight A
0.40000   "opening line, worth remembering"   'sea' in the passage  -> weight B
0.20000   "about the debts"                   'sea' in the context  -> weight C
```

A clean seven-fold separation between a reader's own words and the surrounding
context, decided in phase 2 and only observable now.

**Operators and stemming**, each returning exactly the expected count:
`"never seen the sea"` as a phrase (1), `sea -taverns` (2), `debts or rumour`
(2), `cartographers` matching "cartographer" (2), `SAILORS` matching "sailors"
(1), `believing` matching "believed" (1), nonsense (0).

**The GIN index is used.** With `enable_seqscan = off` the plan is a Bitmap Heap
Scan with `Recheck Cond` on `annotations_search_vector_idx` — and on four rows
the planner picks that shape on its own anyway.

**The rest**: three results rendered, three `<mark>` highlights, no control
characters reaching the browser, the other user's stuffed annotation absent, a
one-character query rejected with a message, and `'; drop table annotations; --`
treated as a search phrase that matched nothing.

---

## 0048 — Margin notes are ordered, not absolutely placed

**Problem.** Notes should sit beside the photographed page, ideally near their
normalized vertical position, but neighbouring annotations can collide.

**Options.** (a) Absolutely position cards from `rect_y` and add collision
handling. (b) Use a normal-flow column sorted by `rect_y`.

**Decision.** (b), with the image and note column side by side on wide screens
and stacked on narrow ones.

**Why.** The order still follows the page from top to bottom, while normal flow
keeps long notes readable and makes the layout responsive without pixel offsets
or another geometry system. The column can be collapsed when the photograph
needs the full width.

---

## 0049 — The page canvas keeps one geometry owner

**Problem.** Moving annotations into a side column narrows the space available
to the photograph and could tempt the page view to measure and re-project it.

**Options.** (a) Measure the new column and project stored rectangles into
pixels. (b) Keep the existing image-sized wrapper and derive the height-limited
width from intrinsic dimensions in CSS.

**Decision.** (b). At 1x the wrapper is still limited by
`calc(78vh * image_width / image_height)`, now within the left grid column.

**Why.** The image, unit-square SVG, and percentage-positioned labels remain
one painted box. The browser continues to scale all three together, at every
viewport and zoom, with no observer or projection code.

---

## 0050 — Navigation uses URL state and small client islands

**Problem.** Page movement, annotation movement, global search, and selected
search results need to work without turning server-rendered features into a
client application.

**Options.** (a) Add a client navigation shell and client search. (b) Keep links
and GET forms as the source of truth, adding keyboard listeners only where a
shortcut needs them.

**Decision.** (b). Search results append `?annotation=<id>`, the page reads it
server-side, and the annotator uses it as initial selection. Search remains a
server component with a GET form and zero client JavaScript.

**Why.** URLs stay shareable and back-button friendly. The small shortcut
islands add `/`, arrows, `j`/`k`, and Escape without duplicating routing or
search state in the browser.

---

## 0051 — Dark mode is a complete token inversion

**Problem.** The original dark mode changed only the body colors, leaving
light-oriented borders, fields, and surfaces inconsistent.

**Options.** (a) Remove dark mode. (b) Override the full semantic paper, ink,
rule, accent, and danger palette under `prefers-color-scheme`.

**Decision.** (b), using warm charcoal rather than black, plus an explicit
`color-scheme` so native controls follow it.

**Why.** Every utility reads the same semantic tokens, so the whole interface
inverts together without component-level dark variants. The print stylesheet
separately returns to black ink on white paper and emits the annotation reading
list without application controls or page photographs.

---

## 0052 — One neutral paper theme, no automatic dark mode

**Problem.** The warm dark inversion made the redesign read as brown and hid
the requested off-white direction on any machine set to dark appearance.

**Options.** (a) Keep tuning the automatic dark palette. (b) Make the designed
off-white palette the single appearance.

**Decision.** (b), superseding 0051.

**Why.** This interface treats the screen as a sheet of paper. A stable neutral
ivory, near-black ink, gray rules, and one vermilion annotation colour makes
that idea clear and keeps the portfolio presentation consistent across machines.

---

## 0053 — Thumbnails are generated at upload, not derived at render

**Problem.** A twelve-page book grid downloaded **24 MB**. `width`, `height` and
CSS change how many pixels are painted, never how many are fetched, so a 2000 by
3000 phone photograph was being pulled down to fill a box a couple of hundred
pixels wide.

**Options.** (a) Supabase Storage image transformations — the obvious answer,
and a paid feature. (b) A `next/image` loader, which is metered on Vercel's free
tier and was already declined in 0022. (c) Generate a thumbnail once, at upload,
with the `sharp` we already depend on.

**Decision.** (c). `pages.thumbnail_storage_key` holds a 480px JPEG derived from
the original; grids and filmstrips use it, and only the page actually being read
gets the full photograph.

**Why.** The work happens once on a write that already involves an upload, and
never again on any read. Measured on the same twelve-page book: **24.17 MB to
0.19 MB**, with individual pages going from 2062 KB to 16 KB.

The column is nullable and readers fall back to the original, because thumbnail
generation is allowed to fail — a page without a thumbnail costs bandwidth, a
failed upload costs the annotation the reader was about to make. Rows predating
the column are fixed by `npm run backfill:thumbnails`.

---

## 0054 — One signing request, and the URL is allowed to be reused

**Problem.** Two separate faults in the same code. Opening a page signed every
image in the book one request at a time — twelve round trips at roughly 290ms
each before any HTML was sent. And because each render signed fresh URLs, every
navigation produced URLs the browser had never seen, so it re-downloaded images
it already had.

**Options.** (a) Leave it; the requests are concurrent. (b) Batch the signing.
(c) Batch it and cache the result so URLs are stable.

**Decision.** (c). `createSignedReads` uses Supabase's batch endpoint, and
`pages.images.ts` caches the result for ten minutes.

**Why.** Concurrency does not make twelve round trips free, and the batch
endpoint exists. Caching is the less obvious half: **a signed URL that changes
on every render is a cache that never hits**, which quietly defeated the
browser's own image cache on every navigation.

This required raising the URL lifetime from five to fifteen minutes, which
weakens 0027 slightly and deliberately. A cached URL is always handed out with
at least five minutes of validity left. It is still short-lived, and still never
stored in the database.

What is cached is an answer, not a permission: every caller has already proved
ownership before reaching the signing code, exactly as before. Keys begin with
the owner's user id, so two users cannot collide.

---

## 0055 — Verifying the session locally

**Problem.** Every protected navigation cost about **870ms of auth alone** —
`getUser()` in the proxy, again in the layout, and again in the page, each one a
round trip to Supabase in Tokyo measured at 284ms.

**Options.** (a) Keep three remote verifications. (b) Deduplicate within a
render and verify remotely once. (c) Deduplicate and verify the token locally
against the project's published signing keys.

**Decision.** All of (b) and (c).

- `getCurrentUser` is wrapped in React's `cache()`, so the layout and the page
  share one answer per request while still being independent calls in the code.
  That independence is deliberate (0016) and now costs nothing.
- It verifies with `getClaims()`, which checks the access token's ES256
  signature against the project's JWKS and its expiry, locally. **1ms against
  284ms.** A tampered signature is rejected — tested, not assumed.
- The proxy no longer verifies at all. It reads the session's expiry locally and
  refreshes only inside a five-minute window before it lapses. Measured cost of
  the proxy afterwards: 4ms.

**Why this is not a reversal of 0015.** That entry's rule was *verify, never
merely decode*. `getSession()` reads the cookie and believes it, which is an
authentication bypass. `getClaims()` proves the token was issued by Supabase and
has not been altered. The proxy's use of `getSession()` decides only whether a
refresh is due — not who the caller is — and every real authorization decision
still runs through `requireUser()`.

**The cost, stated plainly.** Local verification cannot know a user was deleted
or a session revoked since the token was issued, so there is a staleness window
of up to one hour. This app has no ban flow and no "sign out everywhere", and a
deleted user's rows are gone by cascade, so a stale token buys an attacker an
empty library. An app with real revocation requirements should pay the 284ms. A
remote fallback remains for projects without asymmetric signing keys.

---

## 0056 — The connection pool was the reason Promise.all did nothing

**Problem.** Independent queries were wrapped in `Promise.all` and the page got
no faster. Arithmetic gave it away: each additional query added almost exactly
one round trip.

**Cause.** `max: 1` on the postgres client. The original reasoning — "a function
instance handles one request at a time" — is true and irrelevant. It is not
about concurrent *requests*; it is about concurrent *queries within* one. Two
statements issued at the same moment queued behind a single connection.

**Decision.** `max: 3`, with a 20 second idle timeout.

**Why three.** It is the widest fan-out any page here has. The transaction
pooler multiplexes, so idle client connections are cheap, and an idle timeout
hands them back rather than holding them for the life of a warm instance.

Measured, on the book page: **863ms to 429ms**, from a one-line change that only
became visible because the parallelism was already there and doing nothing.

---

## 0057 — Route-level loading files instead of a blank wait

**Problem.** Every protected route is dynamically rendered, and has to be — the
content is one person's library. So the server cannot answer until it has
established who is calling and queried what they own. Even at 400ms that is a
visible dead pause on every navigation.

**Options.** (a) Make routes static — impossible, the data is per-user.
(b) Accept the pause. (c) Add `loading.tsx` at each route so Next sends the
shell immediately and streams the rest.

**Decision.** (c), with skeletons laid out to match the real content — the page
view's places the margin column where the margin column goes — so arriving
content lands where the placeholder already was instead of shoving the layout.

The skeletons are a flat tint, not a shimmer. A shimmering gradient is the house
style of every generated dashboard, it animates something the user cannot act
on, and it is exactly what `prefers-reduced-motion` exists to suppress.

---

## 0058 — Measuring the performance pass

Not a fork, a receipt. Everything above was measured on a production build
against the live project, using a seeded twelve-page book with 2 MB photographs,
median of five runs. The seeded data was removed afterwards.

| | before | after |
| --- | --- | --- |
| `/library` | 1071 ms | **393 ms** |
| `/books/[id]` | 1850 ms | **429 ms** |
| page view | 2550 ms | **799 ms** |
| book grid download | 24.17 MB | **0.19 MB** |
| page view download | 26.18 MB | **2.20 MB** |
| signed URL stable across renders | no | **yes** |

Correctness was re-checked afterwards, because a performance pass is exactly
where a coordinate bug would hide: the filmstrip renders 12 thumbnails and 1
full-size image, `viewBox="0 0 1 1"` is intact, a stored rectangle of
0.6 by 0.04 still reaches the DOM as `width="0.6" height="0.04"`, and a
signed-out request to a page still redirects to `/sign-in`.

The remaining 799ms on the page view is two waves of database round trips to
Tokyo. It could be cut to one by fetching annotations through a join on page
number, at the cost of a cross-domain join in a write-side repository. Not
taken: with a loading skeleton in front of it, the honest fix is a database
closer to the user, not more cleverness.

---

## 0059 — Book covers are copied into our own bucket

**Problem.** The library page rendered as a column of alt text — "Cover of
Empire of Silence" printed in the gap where each cover should be — and then
rearranged itself seconds later when the images arrived.

Two separate causes, and it is worth separating them because only one is a
performance problem:

1. **Open Library's CDN is slow.** Measured on the three real books: 1510ms,
   1550ms and 2786ms, and on a later run 2815ms to 5251ms. For 16 to 24 KB.
2. **A loading image shows its alt text.** That is what was actually on screen.
   Even a fast image would flash it, and no amount of speed removes it.

**Options.** (a) A skeleton behind the image and accept the CDN.
(b) `next/image` with the Open Library host allowed — metered on Vercel's free
tier, and already declined in 0022. (c) Fetch each cover once when the book is
added, store it in the bucket we already use, and serve it the way page
thumbnails are served.

**Decision.** (c), plus the placeholder from (a). They fix different halves.

**Why.** Storing it removes a third party from every library render, and puts
covers on the same batched, cached signing path as everything else — so the URL
is stable and the browser can cache the image between navigations, which it
could not do while the URL came from someone else's CDN with no caching story of
ours.

Measured afterwards: 9 KB instead of 16, and **48 to 138ms warm against Open
Library's 2800ms**. The first fetch of a new object is around a second while the
CDN is cold; every one after is not.

The placeholder is the other half and is not a skeleton component. The wrapper
occupies the cover's exact size from first paint, so nothing moves when the
image lands, and `color: transparent` on the image hides the alt text
*visually* while the bytes are in flight. It is still there for screen readers.
That is the specific artefact that was complained about, and it is a rendering
detail rather than a missing image.

`cover_storage_key` is nullable and `cover_url` is kept, so a failed copy
degrades to the old slow path rather than to no cover at all. Books added before
this existed are fixed by `npm run backfill:covers`.

---

## 0060 — Functions run in Tokyo, next to the database

**Problem.** Vercel puts serverless functions in `iad1` (Washington) by default.
The Supabase project is in `ap-northeast-1` (Tokyo). Every query would then
cross the Pacific — 150 to 180ms each — and this app makes two to three waves of
them to render a page. Deployed on the default, the app would be *slower* than
it is locally, undoing most of the performance pass.

**Options.** (a) Accept it. (b) Move the database to a region near the user.
(c) Move the functions to the database's region.

**Decision.** (c). `vercel.json` pins `regions: ["hnd1"]`.

**Why not (b).** Supabase's region is fixed when the project is created;
changing it means a new project and a migration of the storage bucket, the auth
users and the data. Not worth it, and it would only relocate the same problem if
the audience is elsewhere.

**Why (c) rather than accepting the default.** The two legs are not equal. The
browser-to-function leg is **one** round trip for the HTML document; the
function-to-database leg is **several**, in sequence, because each wave depends
on the last. Colocating turns those into single-digit milliseconds and leaves a
single unavoidable crossing. Static assets are unaffected either way — they come
off Vercel's edge network wherever the function lives.

The honest cost: a reader far from Tokyo pays more latency on that one document
request. That is the right trade when the alternative is paying a smaller
penalty three times over, and it is why the note at the end of 0058 said the fix
was a database closer to the *server*, not more cleverness in the query layer.

Hobby plans allow exactly one region, which is also why this is a single entry
rather than a list.

---

## 0061 — `NEXT_PUBLIC_APP_URL` is set explicitly, not inferred from Vercel

**Problem.** The app refuses to build without `NEXT_PUBLIC_APP_URL`, and the
deployment URL is not known until the project exists. Vercel exposes `VERCEL_URL`
and `VERCEL_PROJECT_PRODUCTION_URL`, so the value could be derived.

**Options.** (a) Fall back to `VERCEL_URL` when the variable is absent.
(b) Require it to be set, and document that it must be set before the first
build.

**Decision.** (b).

**Why.** `NEXT_PUBLIC_*` values are **inlined into the browser bundle at build
time**, not read at runtime, so a fallback would bake whichever URL happened to
be present when the bundle was compiled. On a preview deployment that is a
per-deploy hostname; the confirmation emails it generates would point at a URL
that stops being interesting the moment the next preview is built.

Requiring the variable also keeps the failure loud and early — a build that
refuses to start, rather than auth callbacks that quietly point at
`localhost:3000` in production. That is the same fail-fast rule as 0001, and
this is exactly the case it was written for.

The practical consequence, which belongs in the README rather than being
discovered: **changing this variable requires a redeploy**, because setting it
after the fact changes nothing already compiled.

---

## 0062 — The username lives in a table we own

**Problem.** Accounts need a username. Supabase Auth already stores a per-user
JSON blob, `raw_user_meta_data`, and `signUp` accepts `options.data` to fill it.
That needs no table, no migration and no repository.

**Options.** (a) Put it in `raw_user_meta_data`. (b) A `profiles` table keyed by
the Supabase user id.

**Decision.** (b).

**Why.** `raw_user_meta_data` is writable by the user through `updateUser`, and
there is no way to put a unique constraint on a field inside a JSON column that
its owner can rewrite. Two people could hold the same name, or one could simply
take another's. A username is an identity claim; the guarantee has to be the
database's, not the client's good behaviour.

The table uses the Supabase user id as its own primary key rather than
generating a second identifier. A person has exactly one profile, so a separate
id would only create the possibility of the two disagreeing.

Uniqueness is a unique index on `lower(username)`, not on the column. "Basel"
and "basel" are the same person to a reader, so treating them as two available
names is a small identity bug waiting to happen. Lowercasing on the way in would
also work, but it discards the capitalisation someone chose for their own name.

---

## 0063 — Sign-up creates the account, then the profile, and cannot do both at once

**Problem.** Creating an account now means two writes to two different systems:
Supabase Auth holds the account, our database holds the username. They cannot be
in one transaction.

**Options.** (a) Profile first, then account. (b) Account first, then profile.
(c) Account first, and delete it again if the profile fails.

**Decision.** (b), with the username checked *before* either write, and the
unique index as the real guarantee.

**Why the order.** It is chosen for which orphan is survivable. An account with
no profile can be given one later — the header already falls back to the email,
and `npm run username` sets one. A profile with no account is a row pointing at
nobody, and the foreign key would refuse it anyway.

**Why not (c).** Deleting a just-created account to undo a failed profile insert
means an admin API call on an error path, which is more ways to fail on the
worst day rather than fewer.

**Two checks, deliberately.** `isUsernameTaken` runs before anything is written,
so the ordinary case — a name that is already gone — is a message beside the
field rather than an account that exists in a half-made state. It is explicitly
not the guarantee: two people can pass it in the same instant. The unique index
decides, and the `23505` handler turns losing that race into "that username was
taken a moment ago" instead of a 500.

Verified: twelve rejection cases produced **zero** accounts. Nothing reaches
Supabase Auth until the username is known to be well-formed and free. A direct
duplicate insert bypassing the app was rejected by the index. Deleting an account
released its username by cascade.

The character rule is narrow on purpose — letters, digits and underscores,
starting with a letter. A username has to be typed, said aloud, and possibly put
in a URL one day. The test that made the case for it: `Ьasel`, whose first
character is a Cyrillic soft sign rather than a Latin B, is rejected. Allowing
unicode would let one person wear another's name.

---

## 0064 — One Python service, for the one thing Python is better at

**Problem.** Photographs of book pages are pictures of *quadrilaterals*: the page
recedes, the camera is never square on, and every printed line arrives slanted
and unevenly lit. The original suggestion was to have a language model return a
"scanned" version of the page.

**Options.** (a) An image model regenerating the page. (b) OpenCV in a small
Python service. (c) A WebAssembly build of OpenCV in the browser. (d) Rewrite
the project in Python.

**Decision.** (b). One FastAPI service, one endpoint, in `page-processor/`.

**Why not (a).** It fails twice over. Image models *redraw* rather than clean, so
on a page of prose they silently alter words — fatal for an app whose purpose is
recording what a book actually says. And a regenerated image has different
geometry, so every annotation anchored to the original would point somewhere
else. That is the one invariant the whole project rests on (0031).

**Why not (d).** The annotation canvas — pointer capture, normalized coordinate
maths, the SVG overlay — has to be TypeScript regardless. So the real choice was
never "Python instead of" but "Python as well as", and the second runtime has to
earn its place. Detecting a page outline and warping it flat is exactly what
OpenCV is for, and unpleasant in the JavaScript ecosystem. That earns it.

**Why not (c).** A WASM build would avoid the second process entirely, at the
cost of shipping several megabytes of OpenCV to every visitor to run once per
upload, on whatever phone took the photograph.

The service holds no user data, has no database, and makes no authorization
decisions — ownership is established before it is called. Its API key exists so
that a process listening on a port cannot be used as free image processing by
anything else that can reach it, which is a different and much smaller claim
than authentication.

---

## 0065 — Flattening happens at upload, before the row exists

**Problem.** Rectifying a page *changes its geometry*. Annotation rectangles are
fractions of the image, so flattening an image that already has annotations
would move every one of them.

**Options.** (a) Rectify on demand, when a page is viewed. (b) Rectify at upload
time, before the `pages` row is written. (c) Offer it as an action on an
existing page.

**Decision.** (b), inside `completeUpload`, between reading the uploaded bytes
and inserting the row.

**Why.** At that moment the page has no row, so it can have no annotations, so
there is nothing anchored to the old geometry. It is the only point in the
lifecycle where changing the image is provably safe. (a) and (c) both require
answering "what happens to the existing marks?", and the honest answer is that
they all move.

The original photograph is kept in `pages.original_storage_key`, so a poor
rectification is recoverable and a better detector could be re-run later. The
canonical image becomes the flattened one, and everything downstream — the
thumbnail, the crop sent to the vision model, the annotation canvas — sees only
that.

Two things fall out of doing it here:

- **The bytes are read once.** Rectifying, the thumbnail and the dimensions all
  used to fetch the object separately.
- **The dimensions become ours.** When we produce the image, we know its real
  size, which finally closes the client-reported-dimensions weakness recorded in
  0028 — but *only* then. An untouched phone photo keeps the browser's numbers,
  because sharp reads dimensions before EXIF rotation and the browser reports
  them after, so "correcting" one would silently transpose a portrait page.

---

## 0066 — The processor is optional, and the app must not notice

**Problem.** The service runs on a laptop. The app runs on Vercel. Most of the
time the deployed app cannot reach it at all.

**Options.** (a) Require it, and deploy it somewhere. (b) Make it optional, with
the app degrading to storing photographs exactly as uploaded.

**Decision.** (b). `PAGE_PROCESSOR_URL` unset means the feature does not exist
and nothing else behaves differently.

**Why.** A feature that only works when an extra process happens to be running
must degrade to "the app as it was", or it is not optional — it is a dependency
with an outage. Every failure path in `tryRectify` returns the upload unchanged:
not configured, unreachable, timed out, refused the image, or looked and found
no page. Verified both ways — with the service running the row carries a
`.flat.jpg` canonical image, an original, and dimensions of 1198x1707; with it
stopped the same upload produced a row with the photograph as canonical, a null
original, and the browser's 1560x2060.

The two variables must be set together or not at all, enforced in
`env.server.ts`. A URL without a secret posts images to an unauthenticated
endpoint; a secret without a URL is a configuration somebody abandoned halfway.

---

## 0067 — Verifying phase 10

Not a fork, a receipt.

**Unit tests** (`page-processor/tests/test_rectify.py`, 5 passing) build a flat
page, warp it by a *known* perspective transform onto a dark desk under a
lighting gradient, and grade the result against that ground truth rather than
against an opinion: corner error under 2% of the image, restored aspect ratio
within 5% of the original, corner ordering stable under any rotation or
reversal of the input, a noise image returned untouched, and the lighting
gradient measurably reduced.

**End to end**, through `completeUpload` against the live database and bucket:

```
with the processor      canonical ...flat.jpg   original kept   1198 x 1707
without the processor   canonical ...jpg        original null   1560 x 2060
```

**The result was looked at, not just asserted.** A trapezoidal page on a dark
desk came back square, white and evenly lit, with the text straight.

That inspection found something the tests did not: a thin dark frame around
every page, because the edge detector finds the boundary *between* page and
desk, so its outermost row of pixels is part desk. The quadrilateral is now
pulled inwards by half a percent before the warp — under a pixel of real text —
and measuring the edges afterwards showed the darkest strip at 232 against a
page centre of 248, with no dark band.

---

## 0068 — The reader places the corners, because the detector cannot

**Problem.** Automatic detection (0064) worked on synthetic tests and refused
every real photograph it was given. The first one tried in anger — a paperback
held open on a white desk — produced `X-Rectified: false, confidence 0.000`.

Looking at the picture makes the reason obvious, and it is not a tuning problem:

- The page **curves at the spine**, so its outline is not a quadrilateral at all.
- The facing page is **cut off by the frame**.
- A **thumb covers** one corner.
- Cream paper on a white desk gives **almost no edge contrast**.

The detector assumes a flat page with four findable edges on a contrasting
background. People photograph books held open. The assumption, not the
implementation, was wrong.

**Options.** (a) Tell people to photograph pages flat on a dark surface.
(b) Detect the text block instead of the page edge. (c) Let the reader place
four corners by hand. (d) Cylindrical de-warping tuned for held books.

**Decision.** (c).

**Why not (a).** It is asking people to change how they read to suit the
software. Rejected by the owner in one sentence, correctly.

**Why not (b).** Tried, on the real photograph, before proposing anything. It
merged both pages of the spread into a single block, took the minimum-area
rectangle of the pair, rotated on the wrong axis and cut off the bottom of the
page. Worse than doing nothing. Kept here because "we tried the obvious cheaper
thing and it failed" is worth more than the assertion that it would.

**Why not (d).** Text-line detection and curve fitting is a research project,
not a phase.

**Why (c).** There is nothing to detect, so there is nothing to fail. A person
looking at the picture knows exactly where the page is, and dragging four
handles takes a couple of seconds. It works on a held book, an occluded corner,
a white-on-white desk — every case that defeats the detector.

Automatic detection is kept and tried first when no corners are given, so a flat
page on a contrasting surface still needs no dragging.

**Details worth keeping:**

- Corners are **normalized**, fractions of the image, in the same 0..1 space as
  every annotation rectangle. Pixels are never stored (0031). The picker
  positions handles in percentages over a unit-square SVG, so nothing measures
  anything and it stays correct at any preview size.
- They may arrive **in any order** — dragging produces whatever order the reader
  touched them in. Both the browser and the service sort them with the same
  sum/difference trick; the browser's copy only affects the outline drawn on
  screen, which would otherwise render as a bowtie and look like a bug.
- They are **stored on the row**, so the flattening can be redone or adjusted
  without asking anyone to drag again. Same reason as `original_storage_key`.
- Bad corners are **refused, not ignored**. A tap instead of a drag returns
  `400 Those corners enclose almost nothing.` The reader placed them, so
  silently substituting something else would be baffling.
- The handles respond to **arrow keys**, because a drag-only control is unusable
  without a pointer.

**The limitation this does not remove.** The warp is a homography, so it undoes
perspective and not curvature. A page bowing near the spine still bows. Fixing
that is (d), and it is not worth it: the vision model already receives a
cropped, greyscaled, contrast-normalised region (0039) and reads curved text
perfectly well — the extraction on the very photograph that failed detection was
verbatim correct.

---

## 0069 — Verifying manual corners

Not a fork, a receipt. Eight Python tests pass, three of them new:

- A page **deliberately given a background it cannot be distinguished from** —
  so `rectify` gives up — comes out correctly flattened when corners are
  supplied, with the original aspect ratio restored to within 5%.
- Corners rotated into any of the four possible orders produce an identical
  result.
- Too few corners, a coordinate above 1, a negative coordinate, a non-pair, and
  a tap rather than a drag are each refused rather than guessed at.

End to end through the real `completeUpload`, using **the actual photograph that
automatic detection had refused**:

```
with hand-placed corners   flattened (.flat.jpg)   original kept   corners stored   523 x 937
without corners            the upload              original null   corners null     960 x 1280
```

And the result was looked at, not merely asserted: the desk, the facing page and
the hand are gone, the page fills the frame, the lighting is even and the text is
upright.

---

## 0070 — The reading view is text, not a picture of text

**Problem.** The wish was a clean, even page to read and annotate — "like an
e-book" — with the original photograph still available.

**Options.** (a) Transcribe the page and render the text back into an image,
which keeps every existing rectangle-and-coordinate mechanism working unchanged.
(b) Render it as real HTML text.

**Decision.** (b).

**Why.** (a) would have *looked* like an e-book without being one. No selecting a
sentence, no copying a quote, no resizing the type, nothing for a screen reader
— having gone to the trouble of obtaining real text, it would have been flattened
straight back into pixels.

The cost of (b) is that annotations on it cannot be rectangles: a rectangle over
reflowing text means nothing. They become text ranges, which is how every
e-reader anchors a highlight and is arguably the better fit — a note attached to
*the words* survives reflow and quotes exactly.

So the two surfaces keep different anchors, which is honest rather than a
compromise: the photograph has geometry and gets rectangles, the transcript has
characters and will get ranges. The coordinate design stays live on the
photograph instead of being replaced.

**The photograph stays canonical.** A transcript is what a model believed it
read. Names and unusual words are exactly where that goes wrong, and a cleanly
typeset page hides the mistake rather than showing it. Switching back is one
click, which is what makes trusting the transcript reasonable at all.

Transcription runs in its own request and is cached on the row, for the same
reasons as annotation enrichment (0025, 0043): a write never waits on a model,
and a whole page is the most expensive single call this app makes.

---

## 0071 — Checking the transcript against the page number

**Problem.** How does a reader know a clean transcript is a transcript of *this*
page? The failure mode of a typeset page is that being wrong and being right
look identical.

**Decision.** Ask the model for the page number printed on the page, store it,
and say so when it disagrees with the number the page was filed under.

**Why.** It costs one extra field in a call already being made, and it catches
two different problems with one check: a mis-typed page number at upload, and a
model that transcribed something other than what was in front of it.

It is a warning, never a refusal. A chapter opening often prints no number at
all, and a reader is entitled to file a page however they like. Verified by
filing a photograph of page 317 as page 999: the transcript was correct and the
reading view said so — *"filed as page 999, but the page number printed on the
photograph reads 317"*.

---

## 0072 — A false alarm, and what it cost

Worth recording because the mistake was mine and it was nearly expensive.

The first transcript of a real page came back beautifully formatted, correctly
paragraphed, with hyphenation rejoined — and appeared to be **the wrong page
entirely**. Page 327's prose against a photograph of page 317. None of the words
visible in the picture were in it. It looked exactly like a model recognising a
famous novel and reciting from memory instead of reading, which is the most
dangerous possible failure for this feature, and I reported it as such.

It was a test error. The query said `ORDER BY created_at DESC LIMIT 1`, and a new
page had been uploaded while the test was being written. The model was handed
page 327 and transcribed page 327 correctly. Re-run against explicitly named
pages, both transcribed correctly and both reported their own printed page
numbers.

Two things worth keeping from it:

- **"The most recent row" is not an identifier.** In a test that spans minutes
  against a live database somebody else is using, it silently means a different
  thing at the end than it did at the start. Name the row.
- The check built in response — comparing the printed page number against the
  filed one — turned out to be worth having anyway, which is the only reason
  the hour was not wasted. It is exactly the guard that would have caught a real
  hallucination, and it now catches mis-filed pages instead.

---

## 0073 — Verifying phase 11a

Not a fork, a receipt. Tested against the live model and two real photographs of
book pages:

```
page 317, as uploaded (960x1280)     printed number "317"   matches   1196 chars
page 327, flattened   (1069x2134)    printed number "327"   matches   1638 chars
filed as 999                          printed number "317"   MISMATCH WARNED
second call on a transcribed page     cached in 415ms, model not called
```

Transcripts came back paragraphed with hyphenated line breaks rejoined, which is
the single most common way a naive page transcript is unusable.

One call returned `retryable` rather than a transcript, after a long run of
experiments against a free tier limited to about fifteen requests a minute. That
is the rate-limit path behaving correctly rather than a defect — it is recorded
here because it is what the feature will do on a bad afternoon.

---

## 0074 — The model is chosen on quota, not on latency

**Problem.** Transcription started failing with "rate limited". Investigating it
produced a number that changed the whole picture:

```
limit: 20    quota: GenerateRequestsPerDayPerProjectPerModel-FreeTier
```

Twenty requests **per day** on `gemini-3.5-flash`. Not per minute. One
afternoon of testing exhausts it, and an app that reads a page per upload and a
region per annotation cannot live inside it.

**What went wrong.** DECISIONS 0042 chose that model by measuring latency
across candidates — carefully, with repeated trials — and never checked the
quota. The measurement was real and the conclusion was useless, because it
optimised the wrong axis. Free-tier quota is per model and per day, and it is
the binding constraint; latency is a rounding error next to "you may do this
twenty times".

**Decision.** Default to `gemini-3.5-flash-lite`.

**Why.** Tested on a real photograph of a book page, both models were
*indistinguishable on quality*: every marker word present, the correct printed
page number, hyphenation rejoined, output within a few characters of the same
length. The lite model was also twice as fast — 1806ms against 3762ms.

So the flash model bought nothing and cost the daily allowance. Lite models get
a larger free allowance precisely because they are cheaper to run, which is the
axis that matters here.

**The general lesson, worth more than the model name.** When a limit is measured
in requests per day, capability comparisons are decoration. Check what a tier
permits before comparing what it can do.

---

## 0075 — "Try again shortly" was a lie half the time

**Problem.** Every 429 produced the same message: *"The model is rate limited
right now. Try again shortly."* For a per-minute limit that is true. For a
per-day limit it is false and actively unhelpful — the reader waits, retries,
sees the same message, and has no way to learn that the answer is "tomorrow".

**Decision.** Parse the quota violation Gemini returns in the response body and
distinguish the two.

Gemini does not put this in a header; it comes back as structured `details`
containing a `quotaId` such as
`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, along with a `retryDelay`.
`PerDay` in that id now produces:

> Today's free quota for this model is used up. It resets tomorrow, or you can
> point GEMINI_VISION_MODEL at a different model.

which is both true and actionable — the quota is per model, so switching models
grants a fresh allowance immediately.

Verified against a genuinely exhausted quota rather than a simulated one: the
`PerDay` id was present, the branch fired, and the message was the second one.

---

## 0076 — Two anchors, one table, one constraint

**Problem.** Annotations on the photograph are rectangles in normalized
coordinates. Annotations on the transcript cannot be: the text reflows, so a
rectangle over it means nothing the moment the window changes width.

**Options.** (a) A second table for text annotations. (b) One table, with a
discriminator and both sets of columns nullable.

**Decision.** (b). An `anchor` enum of `'region' | 'text'`, the rectangle
columns made nullable, character offsets and a quote added.

**Why.** They are the same thing — a note a reader attached to part of a page —
and everything downstream treats them identically: one list, one search index,
one delete path. A second table would have meant duplicating all of that to
express a difference that only matters when rendering.

The cost of nullable columns is a row that is *neither*: no rectangle, no range,
attached to nothing. That is closed in the database rather than by hoping every
code path remembers:

```
CHECK (
  (anchor = 'region' AND rect_x IS NOT NULL AND ... AND text_start IS NULL)
  OR
  (anchor = 'text'   AND text_start IS NOT NULL AND text_end > text_start
                     AND quoted_text IS NOT NULL AND rect_x IS NULL)
)
```

Verified by trying to break it: a row attached to nothing, a text anchor
carrying a rectangle as well, an end before its start, and a region anchor with
no rectangle were all rejected with `23514`.

`isRegionAnnotation` and `isTextAnnotation` narrow that guarantee back into the
type system, so the canvas can use the four numbers without apologising to the
compiler for a database rule it cannot see.

---

## 0077 — A text annotation needs no model at all

**Problem.** A region annotation is born `pending` and waits for a vision call
to discover what it covers. Should a text annotation do the same?

**Decision.** No. It is born `complete`, with `extracted_passage` set to the
selected text and `extracted_context` sliced from the transcript around it.

**Why.** The reader selected the words. Asking a model to read them back would
spend a scarce daily quota — measured at twenty calls a day (0074) — to
reproduce a string already in hand, and would introduce a pending state, a
failure mode and a retry button for an operation that cannot fail.

This is the quiet advantage of the text anchor, and it only became obvious once
the quota was understood. Region annotations are rationed by the free tier; text
annotations are not rationed at all.

---

## 0078 — The quote is stored alongside the offsets

**Problem.** Offsets into a transcript are brittle. Re-read a page, have the
model render one word differently, and every offset after it shifts — silently,
because a shifted offset still points *somewhere*.

**Decision.** Store `quoted_text` as well, captured at the moment of selection,
and check it still matches before writing.

**Why.** Redundant on purpose. The quote is what makes drift detectable, and it
is what gets displayed — so an annotation still reads correctly even when its
offsets have gone stale. `createTextAnnotation` refuses a selection whose quote
no longer matches its range, which also covers the ordinary case of a stale
browser tab.

Three layers, each catching what it can see: Zod validates shape at the action,
the service validates against the actual transcript, and the check constraint
guarantees the row is coherent. Verified: a mismatched quote, a range beyond the
end of the transcript and an empty range were each refused.

The quote comes from `transcript.slice(start, end)`, not from
`selection.toString()`. The browser inserts line breaks between block elements,
so a selection spanning two paragraphs would not match the stored text and the
server would reject a perfectly good selection.

---

## 0079 — Paragraph offsets, and the test that caught them

Splitting a transcript for display is trivial. Splitting it *without losing
where each paragraph started* is what text anchoring depends on, and the obvious
implementation throws exactly that away:

```
transcript.split(/\n\s*\n/).map((p) => p.trim())
```

`splitIntoParagraphs` scans with `exec` instead and returns each paragraph with
its absolute start, so a browser offset becomes a transcript offset by one
addition. The same function runs in the browser and on the server — if the two
disagreed about where a paragraph begins, every annotation would be wrong by the
difference.

**The first implementation was wrong**, and a unit test caught it. It assumed
the separator between paragraphs was one character; a blank line is at least
two, and more when it carries spaces. Every paragraph after the first was
shifted, and nothing failed — the offsets simply pointed a few characters off.

That is the failure mode worth paying a test for: not a crash, but a quiet
mis-selection that would only ever be noticed by a reader wondering why their
highlight covered the wrong words. `npm run test:offsets`.

---

## 0080 — Verifying text annotations

Not a fork, a receipt. Through the real service, against a page with a stored
transcript:

```
select "Midge confirmed with a curt nod" at [64, 95)

anchor        text
range         [64, 95)
quote         "Midge confirmed with a curt nod"
passage       "Midge confirmed with a curt nod"   (no model call)
status        complete
rectangle     null
context       sliced from the transcript around it
```

Rejected: a quote that does not match its range, a range past the end of the
transcript, an empty range, and a page with no transcript at all — each with its
own status rather than a generic failure.

The database refused four malformed rows independently of the application.

---

## 0081 — Delete the row before deleting its objects

**Problem.** Pages and books own objects in storage as well as rows in the
database. A partial failure can leave either visible data with missing images or
unreferenced objects.

**Decision.** Collect every referenced storage key, delete the database row
inside the repository boundary, and only then remove the collected objects.
Page and book cascades remove their annotations through foreign keys. This
supersedes the object-first order described in 0030.

**Why.** A storage failure now leaves an invisible orphan that can be swept
later, rather than a visible page or book whose image has already disappeared.
The UI reports incomplete cleanup after the authoritative row deletion.

---

## 0082 — Destructive scope is visible before page and book deletion

An annotation is a small, direct action and is deleted without a confirmation
dialog. A page confirmation includes its annotation count. A book confirmation
includes both its page count and total annotation count. The counts are scoped
to the signed-in user through the repositories, just like the mutations.

These are permanent deletes. Soft deletion would add filtering and retention
states throughout a small personal library without providing recovery yet; the
database cascades already express the ownership model cleanly.

---

## 0083 — The product is Bookynotes

The product name, package name, user-agent strings, local launcher and current
documentation use **Bookynotes** / `bookynotes`. Historical entries in this
decision log retain the names that were true when those decisions were made.
The reserved product username changes with the product so current source and
configuration contain no stale identifier.

---

## 0084 — Orphan cleanup is explicit and dry-run first

`npm run sweep:orphans` compares objects in the page-image bucket with every
page and cover key still referenced by the database. It prints orphan keys but
does not mutate storage. Passing `-- --delete` opts into batched removal.

This is the repair path for row-first deletions whose storage cleanup was
interrupted. Keeping deletion opt-in makes the maintenance command safe to
inspect before it changes production storage.

---

## 0085 — Expired image credentials renew at the image boundary

**Problem.** A client-side route cache can outlive the signed storage URLs
embedded in its server-rendered payload. Navigation then displays blank covers
and pages until a full reload obtains fresh credentials.

**Decision.** When a private image fails, it asks an authenticated route for a
fresh signed URL for its user-owned storage key, then retries with short,
increasing delays. The route never signs a key outside the current user's
prefix, returns no-store responses, and the image stops after four attempts.
Concurrent recovery for the same key shares one request.

**Why.** Re-signing the failed resource fixes the expired credential directly;
replaying the old URL or refreshing the whole page does not. The fixed limit
preserves a real missing-image failure instead of polling indefinitely.

The ordinary path still renders `src` during SSR so the preload scanner,
`fetchPriority`, eager loading and no-JavaScript rendering keep working. If that
request fails before hydration attaches `onError`, the component detects the
recorded DOM state (`complete` with zero intrinsic width) on mount. Signed URLs
live for fifteen minutes and are now cached for five, not ten, so ordinary
traffic begins background revalidation with roughly ten minutes remaining.
Because time-based revalidation may serve one stale response while refreshing,
recovery remains the safety net for an unusually old entry.

---

## 0086 — Page upload is a compact sequence, not a loose form

The book view groups page metadata and photograph selection into one compact
editorial panel. File type, size and privacy guidance sit beside the control
they explain; progress and the primary action share a stable footer. Alignment
controls remain hidden until a photograph exists, then appear before the upload
action so the visual order matches the task order.

This keeps the common empty state concise without hiding the existing corner
correction workflow when it becomes relevant.

---

## 0087 — Missing passage extraction runs as a visible queue

Region annotations can be created faster than Gemini can read them, and on the
free tier they can also fail for reasons that are not the annotation's fault:
daily quota, per-minute rate limits, or a temporary storage read failure.

The page now exposes that state directly. Notes say whether they are pending,
being read, failed, or complete, including the last error and retry count when
there is one. A page-level "extract missing passages" action walks incomplete
region notes sequentially rather than firing them in parallel.

Sequential is intentional. It is slower in the happy path, but it avoids turning
one page view into a burst of vision requests, which is exactly the shape that
free-tier limits punish. If the queue hits a retryable wall, it stops with the
message visible and can be run again later.

---

## 0088 — Library dashboards show operational state

The library and book pages now show the work left inside the collection: page
count, note count, transcript coverage, pending passage extraction and failed
passage extraction. The counts are computed on the server from the same scoped
repositories as the rest of the app, not fetched by client-side widgets.

This is a product-quality feature rather than a storage feature. It makes the
app easier to demo because a reviewer can see that the system has lifecycle
states, not just static cards: pages are captured, transcripts are generated,
passages are extracted, and failures remain visible until handled.

---

## 0089 — Search results explain the match

Search can match the reader's note, a selected passage, a model-read passage or
the surrounding context. Showing a flat list of snippets made some correct hits
look arbitrary, especially when the query matched context rather than the main
passage.

Results are now grouped by book and page, each hit is labelled by source, and
context has its own snippet. Text annotations are marked as "no model" to make
the free path visible beside image annotations that depend on Gemini. Loose
punctuation-insensitive matches also get client-rendered term highlighting when
Postgres cannot produce a `ts_headline` match.

---

## 0090 — Manual transcripts are a first-class reading path

Gemini can read a page, but it is not the only way a page becomes searchable.
If the reader already has text from an ebook, another OCR tool or manual typing,
the app should accept that text without spending scarce vision quota.

Reading view now presents two explicit paths when a page has no transcript:
"Use Gemini" and "Paste manually." A pasted transcript is saved through the
same endpoint as transcript edits, appears immediately after saving, and unlocks
text annotations with no model call. Existing saved transcripts also avoid
claiming they were read by Gemini, because once manual editing exists the app no
longer knows or needs to know the source.

---

## 0091 — Capture quality is checked before upload

Bad photographs are expensive later: they make corner placement harder, reduce
transcription quality, and spend scarce model quota on inputs that were visibly
weak before upload. The cheapest place to catch that is the browser, while the
file is already selected and before any storage or Gemini request happens.

The uploader now samples the selected image client-side and reports advisory
warnings for low resolution, landscape orientation, very narrow crops, dark or
over-bright exposure, low contrast and large files. It does not block upload.
The reader may knowingly keep a flawed photograph, and the server remains the
authority for file type, size and ownership. This is a guide rail, not a gate.
