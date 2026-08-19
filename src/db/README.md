# db

The Drizzle client, the schema, and the SQL migrations.

The schema lives here centrally rather than inside each feature, one file per
table. Migrations are global and relations cross domains, so a single place to
read the whole data model is worth breaking feature-first grouping for. See
`docs/DECISIONS.md`.

Queries do not live here. They live in each feature's repository, which is what
enforces user scoping.

Built in phase 2.
