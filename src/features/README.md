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
A feature importing another feature's repository is a smell: go through its
service, or move the shared piece down a layer.
