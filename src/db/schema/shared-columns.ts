import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

import type { UserId } from "@/db/ids";

/**
 * Column definitions repeated on every table, defined once so they cannot
 * drift apart. These are plain object spreads, not an inheritance mechanism:
 * `...timestamps` in a table definition is exactly equivalent to writing both
 * columns out by hand.
 */

/**
 * The owning user. Present on every table including `pages` and `annotations`,
 * where it is technically derivable by joining up to `books`.
 *
 * That denormalisation is deliberate: it lets every scoped query filter on the
 * table it is already reading, so "did we remember to scope this?" is a
 * one-line check in one place rather than a question about join correctness.
 * The cost is that inserts must set it consistently — see the repositories,
 * which derive it from the parent row rather than trusting the client.
 *
 * There is no `.references()` here even though this really is a foreign key to
 * `auth.users`. Supabase owns that table, and declaring it in the Drizzle
 * schema makes drizzle-kit try to CREATE it. The constraints are added by the
 * hand-written migration `0001_auth_user_foreign_keys.sql` instead.
 */
export const userIdColumn = () => uuid("user_id").notNull().$type<UserId>();

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Updated by the application, not a trigger: a trigger would be invisible
  // from the TypeScript side and this project favours the explicit version.
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

/** Server-side uuid generation, so ids never depend on client input. */
export const primaryId = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);
