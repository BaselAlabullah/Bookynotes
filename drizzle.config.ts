import { loadEnvFile } from "node:process";

import { defineConfig } from "drizzle-kit";

// drizzle-kit runs as a plain Node process, outside Next, so nothing has loaded
// .env.local for it. Node 20.6+ can do this natively — no dotenv dependency.
// In CI the variables are already in the environment and the file is absent,
// which is not an error.
try {
  loadEnvFile(".env.local");
} catch {
  // No local env file. Fall through to whatever is already in process.env.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",

  /**
   * Only manage the `public` schema. Supabase owns `auth`, `storage` and
   * several others; without this filter drizzle-kit would see them as tables it
   * did not create and generate DROP statements for them.
   */
  schemaFilter: ["public"],

  dbCredentials: {
    /**
     * Migrations need the session pooler or direct connection (port 5432), not
     * the transaction pooler used at runtime: DDL and the advisory lock that
     * guards a migration run both require a session that outlives a single
     * statement.
     *
     * `generate` reads only the schema files and never connects, so an empty
     * value here is fine until you actually run `migrate`.
     */
    url: process.env.DATABASE_MIGRATION_URL ?? "",
  },

  // Print the SQL before running it. This is a project about understanding
  // what happens, and migrations are the least reversible thing in it.
  verbose: true,
  // Ask before applying anything destructive.
  strict: true,
});
