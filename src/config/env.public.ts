import { z } from "zod";

/**
 * Environment values that are safe to ship to the browser.
 *
 * Two rules govern this file:
 *
 * 1. Next inlines `NEXT_PUBLIC_*` at build time by substituting the literal
 *    text `process.env.NEXT_PUBLIC_FOO`. You therefore cannot iterate over
 *    `process.env` or destructure it first — every key must be written out in
 *    full below, exactly once.
 * 2. Nothing secret goes in here. Server-only values live in env.server.ts
 *    (added in phase 2) so that importing one can never leak the other.
 */
const publicEnvSchema = z.object({
  /** Absolute origin of this deployment. Used for auth callbacks and metadata. */
  NEXT_PUBLIC_APP_URL: z.url(),

  /** Supabase project origin, e.g. https://<ref>.supabase.co */
  NEXT_PUBLIC_SUPABASE_URL: z.url(),

  /**
   * Supabase publishable key (formerly the anon key). Public on purpose.
   * It is only safe because row level security is enabled on every table with
   * zero policies, so this key can read nothing over Supabase's REST endpoint.
   * Verified against the live project — see DECISIONS 0011 and 0013.
   */
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().startsWith("sb_publishable_"),
});

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  // Fail at startup rather than at the first request that needs the value.
  // A missing app URL in production shows up as broken auth redirects, which
  // is much harder to diagnose than a build that refuses to start.
  throw new Error(`Invalid public environment variables:\n${problems}`);
}

export const publicEnv = parsed.data;
