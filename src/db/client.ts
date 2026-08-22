import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { serverEnv } from "@/config/env.server";

import * as schema from "./schema";

/**
 * The Drizzle client. One per process, shared by every repository.
 *
 * Two settings matter here and both are consequences of running on serverless
 * functions behind Supabase's transaction pooler:
 *
 * - `prepare: false` — the transaction pooler hands each statement to whichever
 *   backend is free, so a prepared statement created on one connection is not
 *   there on the next. Leaving this on produces intermittent
 *   "prepared statement does not exist" errors under concurrency, which is a
 *   miserable thing to debug.
 * - `max: 3` — a function instance handles one request at a time, so this is
 *   not about concurrent *requests*. It is about concurrent *queries within*
 *   one: a page that fetches its book and its page list at the same time gets
 *   no benefit from `Promise.all` if both statements queue behind a single
 *   connection. Measured, that was the difference between two round trips and
 *   one — about 200ms per wave, on a database in Tokyo. Three is the widest
 *   fan-out any page here has; the transaction pooler multiplexes, so idle
 *   client connections are cheap.
 *
 * The client is cached on globalThis because Next's dev server re-evaluates
 * modules on every edit; without the cache, an afternoon of hot reloads leaks
 * a connection each time until the pooler refuses new ones.
 */
const globalForDb = globalThis as unknown as {
  connection: ReturnType<typeof postgres> | undefined;
};

const connection =
  globalForDb.connection ??
  postgres(serverEnv.DATABASE_URL, {
    prepare: false,
    max: 3,
    // Hand connections back to the pooler rather than holding them for the
    // life of a warm function instance.
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.connection = connection;
}

export const db = drizzle(connection, { schema });

/** The type every repository takes when it needs to run inside a transaction. */
export type Database = typeof db;
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
