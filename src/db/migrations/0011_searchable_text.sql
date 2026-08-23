-- Hand-edited after generation: drizzle-kit cannot emit CREATE EXTENSION, and
-- `gin_trgm_ops` does not exist until pg_trgm is installed.
--
-- Supabase keeps extensions in the `extensions` schema rather than `public`,
-- and the operator class is schema-qualified below so the index builds
-- regardless of the migration role's search_path.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "search_text" text GENERATED ALWAYS AS (regexp_replace(lower(coalesce(user_comment, '') || ' ' || coalesce(extracted_passage, '') || ' ' || coalesce(extracted_context, '')), '[^[:alnum:]]+', ' ', 'g')) STORED;--> statement-breakpoint
CREATE INDEX "annotations_search_text_trgm_idx" ON "annotations" USING gin ("search_text" extensions.gin_trgm_ops);
