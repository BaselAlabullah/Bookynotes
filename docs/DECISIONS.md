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
