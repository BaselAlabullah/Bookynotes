import { eq, sql } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db/client";
import type { UserId } from "@/db/ids";
import { profiles } from "@/db/schema";

export type Profile = typeof profiles.$inferSelect;

/**
 * Every query against the `profiles` table.
 *
 * Unlike the other repositories, these are not scoped by a `userId` in a WHERE
 * clause for access control — the user id *is* the key. `isUsernameTaken` is
 * deliberately not scoped at all, because the question it answers is global.
 */

export async function createProfile(
  userId: UserId,
  username: string,
): Promise<Profile> {
  const [created] = await db
    .insert(profiles)
    .values({ userId, username })
    .returning();

  if (!created) {
    throw new Error("Insert into profiles returned no row");
  }

  return created;
}

/**
 * The signed-in user's profile.
 *
 * Request-cached for the same reason `getCurrentUser` is: the layout renders
 * the username and a page may want it too, and neither should have to know
 * whether the other already asked.
 */
export const findProfile = cache(
  async (userId: UserId): Promise<Profile | null> => {
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    return profile ?? null;
  },
);

/**
 * Whether a username is already spoken for, compared without case.
 *
 * This is a courtesy, not the guarantee. Two people can pass this check at the
 * same moment and only one insert will succeed — the unique index decides, and
 * `signUpAction` handles losing that race. Checking first exists only so the
 * common case produces "that name is taken" next to the field rather than a
 * failure after the account is made.
 */
export async function isUsernameTaken(username: string): Promise<boolean> {
  const [row] = await db
    .select({ exists: sql<number>`1` })
    .from(profiles)
    .where(sql`lower(${profiles.username}) = lower(${username})`)
    .limit(1);

  return row !== undefined;
}
