# features

Domain code. One folder per domain, never per technical layer.

Every feature folder uses the same slots, so learning one teaches you all of them:

| File | Responsibility |
| --- | --- |
| `<name>.types.ts` | Domain types. Derived from the Drizzle schema where possible. |
| `<name>.schema.ts` | Zod validators for anything crossing the API boundary. |
| `<name>.repository.ts` | The only place that queries this domain's tables. Every function takes a `userId`. |
| `<name>.service.ts` | Multi-step orchestration. Only exists when there is any. |
| `components/` | React components specific to this domain. |
| `hooks/` | React hooks specific to this domain. |

A feature may import from `integrations/`, `db/`, `config/` and `components/ui/`.

Between features there is exactly one legal direction:

- A **repository** touches only its own tables. Never another feature's.
- A **service** may call another feature's repository.

So `pages.service` calls `books.repository` to check that a book belongs to the
user before writing a page into it, and `pages.repository` stays a thin, honest
wrapper over one table. Because the arrow only ever points service to
repository, there is no import cycle to reason about.
