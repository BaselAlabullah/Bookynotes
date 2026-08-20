import { sql } from "drizzle-orm";
import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { UserId } from "@/db/ids";

import { timestamps } from "./shared-columns";

/**
 * The part of a person's identity that is ours to own.
 *
 * Supabase Auth holds the email and the password. A username could have gone in
 * `auth.users.raw_user_meta_data`, which needs no table at all — and that is
 * exactly why it does not live there: user metadata is writable by the user
 * through `updateUser`, and there is no way to put a unique constraint on it.
 * Two people could pick the same name, or one person could take another's.
 *
 * A table we own can enforce both. The username is unique, and only this app
 * writes it.
 */
export const profiles = pgTable(
  "profiles",
  {
    /**
     * The Supabase user id, used directly as the primary key rather than
     * generating a second identifier. A person has exactly one profile, so a
     * separate id would only create the possibility of them disagreeing.
     *
     * The foreign key to `auth.users` is added by a hand-written migration for
     * the reason given in DECISIONS 0010.
     */
    userId: uuid("user_id").primaryKey().$type<UserId>(),

    /** Stored as typed, compared without case. See the index below. */
    username: text("username").notNull(),

    ...timestamps,
  },
  (table) => [
    /**
     * Unique on the lowercased value, not on the column.
     *
     * "Basel" and "basel" are the same person to a reader, so treating them as
     * two available usernames would be a small identity bug waiting to happen.
     * Lowercasing on the way in would work too, but it throws away the
     * capitalisation someone chose for their own name.
     */
    uniqueIndex("profiles_username_lower_key").on(
      sql`lower(${table.username})`,
    ),
  ],
).enableRLS();
