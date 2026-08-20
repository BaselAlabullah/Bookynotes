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

  /**
   * Which implementation of the vision interface to use. Everything about the
   * enrichment pipeline is provider-agnostic except this one line.
   */
  VISION_PROVIDER: z.enum(["gemini", "openrouter"]).default("gemini"),

  /** Google AI Studio. Free tier, no card, rate limited per minute and per day. */
  GEMINI_API_KEY: z.string().min(1).optional(),

  /**
   * Pinned rather than an alias, so the model cannot change under the app
   * without a commit.
   *
   * Not `gemini-flash-latest`: measured, it answered 503 "experiencing high
   * demand" while pinned models were fine, and a moving alias means the thing
   * transcribing your books can change overnight.
   *
   * Which models a key can reach varies by account and changes over time —
   * `gemini-2.5-flash` is still *listed* by the models endpoint but refuses new
   * keys with a 404.
   *
   * The default is a *lite* model, and the reason is quota rather than speed.
   * Free-tier limits are per model and per day, and they are small: measured on
   * a real key, `gemini-3.5-flash` allows **twenty requests a day**, which one
   * afternoon of testing exhausts. Choosing on latency alone — as an earlier
   * version of this line did — picks a model the app cannot actually use.
   *
   * On transcription quality the two were indistinguishable: both read a real
   * book page with every marker word correct, the right printed page number and
   * hyphenation rejoined. The lite model was also twice as fast.
   */
  GEMINI_VISION_MODEL: z.string().min(1).default("gemini-3.5-flash-lite"),

  /** openrouter.ai. The fallback provider. */
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_VISION_MODEL: z
    .string()
    .min(1)
    .default("meta-llama/llama-3.2-11b-vision-instruct:free"),

  /**
   * The page-processor service, if one is running.
   *
   * The only optional integration in the app. Unset — which it usually is on
   * the deployed instance, because the service runs locally — page photographs
   * are stored exactly as uploaded and nothing else behaves differently.
   */
  PAGE_PROCESSOR_URL: z.url().optional(),
  PAGE_PROCESSOR_SECRET: z.string().min(16).optional(),
}).superRefine((env, ctx) => {
  // A URL without a secret would send images to an unauthenticated endpoint,
  // and a secret without a URL is a configuration someone abandoned halfway.
  // Neither is what anybody meant.
  if (Boolean(env.PAGE_PROCESSOR_URL) !== Boolean(env.PAGE_PROCESSOR_SECRET)) {
    ctx.addIssue({
      code: "custom",
      path: ["PAGE_PROCESSOR_URL"],
      message:
        "PAGE_PROCESSOR_URL and PAGE_PROCESSOR_SECRET must be set together, or neither.",
    });
  }

  // The key is required only for the provider actually selected. A missing key
  // for the provider you are not using is not an error, and demanding both
  // would mean signing up for an account you have no intention of using.
  const requiredKey =
    env.VISION_PROVIDER === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY";

  if (!env[requiredKey]) {
    ctx.addIssue({
      code: "custom",
      path: [requiredKey],
      message: `${requiredKey} is required when VISION_PROVIDER is "${env.VISION_PROVIDER}".`,
    });
  }
});

const parsed = serverEnvSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  throw new Error(`Invalid server environment variables:\n${problems}`);
}

export const serverEnv = parsed.data;
