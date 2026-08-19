# db

The Drizzle client, the schema, and the SQL migrations.

```
client.ts            one postgres-js connection, tuned for serverless
ids.ts               branded id types (UserId, BookId, PageId, AnnotationId)
schema/              one file per table, plus shared column definitions
migrations/          generated SQL, checked in, applied in order
```

The schema lives here centrally rather than inside each feature, one file per
table. Migrations are global and relations cross domains, so a single place to
read the whole data model is worth breaking feature-first grouping for. See
`docs/DECISIONS.md` 0003.

Queries do not live here. They live in each feature's repository, which is what
enforces user scoping.

## Migrations

```bash
npm run db:generate    # diff the schema files, write a new SQL file
npm run db:migrate     # apply pending files to DATABASE_MIGRATION_URL
```

Both are checked into git and applied in order. `drizzle-kit push` is **not**
used and must not be: it diffs against the live database, and would drop the
foreign keys in `0001_auth_user_foreign_keys.sql`, which are deliberately
absent from the schema files.
