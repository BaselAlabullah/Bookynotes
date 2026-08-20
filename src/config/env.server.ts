import { z } from "zod";

/**
 * Environment values that must never reach the browser.
 *
 * The guard below is the safety net, not the mechanism. What actually keeps
 * these off the client is that this module is only ever imported from
 * server-only code (route handlers, server components, the database client).
 * If that ever stops being true, this throws at module load with a message
 * naming the problem, instead of quietly shipping a secret in a JS bundle.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "env.server.ts was imported from client code. Move the import into a " +
      "server component or route handler.",
  );
}

const serverEnvSchema = z.object({
  /**
   * Runtime Postgres connection. Must be Supabase's transaction pooler
   * (port 6543): each serverless invocation opens its own connection, and the
   * direct connection's limit is exhausted almost immediately under that
   * pattern. Migrations use a different URL — see drizzle.config.ts.
   */
  DATABASE_URL: z.string().min(1).startsWith("postgres"),

  /**
   * Supabase secret key (formerly the service_role key). Bypasses row level
   * security entirely, which is exactly why it lives here and never gets a
   * NEXT_PUBLIC_ prefix.
   *
   * It is needed because the page-images bucket is private and RLS on
   * storage.objects denies everything by default. This app issues signed URLs
   * with it *after* performing its own ownership check — the key is never the
   * authorization, it is what carries out a decision already made.
   */
  SUPABASE_SECRET_KEY: z.string().startsWith("sb_secret_"),

  /** Name of the private bucket holding page photographs. */
  SUPABASE_STORAGE_BUCKET: z.string().min(1),
});

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  throw new Error(`Invalid server environment variables:\n${problems}`);
}

export const serverEnv = parsed.data;
