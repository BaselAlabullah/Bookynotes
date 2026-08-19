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
 * - `max: 1` — a function instance handles one request at a time, so a pool of
 *   more than one connection just holds pooler slots open for nothing.
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
  postgres(serverEnv.DATABASE_URL, { prepare: false, max: 1 });

if (process.env.NODE_ENV !== "production") {
  globalForDb.connection = connection;
}

export const db = drizzle(connection, { schema });

/** The type every repository takes when it needs to run inside a transaction. */
export type Database = typeof db;
