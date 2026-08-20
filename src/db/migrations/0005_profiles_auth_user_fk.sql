-- Hand-written, for the same reason as 0001: declaring auth.users in the
-- Drizzle schema makes drizzle-kit try to CREATE it, which fails against a real
-- Supabase database.
--
-- ON DELETE CASCADE so that deleting an account releases its username. Without
-- it, a deleted user's name would stay reserved forever with nothing behind it.

ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_user_id_auth_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
