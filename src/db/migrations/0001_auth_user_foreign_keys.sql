-- Hand-written. Links every user_id column to Supabase's auth.users table.
--
-- These constraints cannot be expressed in the Drizzle schema: declaring
-- auth.users there makes drizzle-kit emit `CREATE SCHEMA "auth"` and
-- `CREATE TABLE auth.users`, both of which fail against a real Supabase
-- database because Supabase already owns them.
--
-- The payoff is that deleting a user removes their entire library in one
-- statement, enforced by Postgres. No application code has to remember.
--
-- Caveat: `drizzle-kit push` diffs against the live database and would drop
-- these, because they are absent from the schema files. This project uses
-- `generate` + `migrate` only. Do not run push.

ALTER TABLE "books"
  ADD CONSTRAINT "books_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "pages"
  ADD CONSTRAINT "pages_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "annotations"
  ADD CONSTRAINT "annotations_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
