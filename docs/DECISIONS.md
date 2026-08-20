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
