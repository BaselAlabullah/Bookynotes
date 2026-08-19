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
