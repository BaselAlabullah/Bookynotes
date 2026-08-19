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
