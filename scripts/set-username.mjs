/**
 * Give an existing account a username.
 *
 * New accounts get one at sign-up. This is for accounts created before profiles
 * existed, which would otherwise be shown by email forever.
 *
 *   node scripts/set-username.mjs <email> <username>
 *
 * Run with no arguments to list accounts and whether they have one.
 *
 * The rules below mirror `usernameSchema` in
 * `src/features/auth/auth.schema.ts`, which is the source of truth.
 */
import { loadEnvFile } from "node:process";

import postgres from "postgres";

loadEnvFile(".env.local");

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

const [email, username] = process.argv.slice(2);

if (!email) {
  const rows = await sql`
    SELECT u.email, p.username
    FROM auth.users u
    LEFT JOIN profiles p ON p.user_id = u.id
    ORDER BY u.created_at`;

  console.log("accounts:");
  for (const row of rows) {
    console.log(`  ${row.email.padEnd(32)} ${row.username ?? "(no username)"}`);
  }
  console.log("\nusage: node scripts/set-username.mjs <email> <username>");
  await sql.end();
  process.exit(0);
}

if (!username || !/^[a-zA-Z][a-zA-Z0-9_]{2,23}$/.test(username)) {
  console.error(
    "A username is 3 to 24 characters: letters, digits and underscores, starting with a letter.",
  );
  await sql.end();
  process.exit(1);
}

const [user] = await sql`SELECT id FROM auth.users WHERE email = ${email}`;

if (!user) {
  console.error(`No account with the email ${email}.`);
  await sql.end();
  process.exit(1);
}

try {
  // Upsert, so running it twice to correct a typo works rather than failing on
  // the primary key.
  await sql`
    INSERT INTO profiles (user_id, username)
    VALUES (${user.id}, ${username})
    ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username, updated_at = now()`;

  console.log(`${email} is now "${username}".`);
} catch (error) {
  // 23505 from the case-insensitive unique index: somebody else has the name.
  console.error(
    error.code === "23505"
      ? `"${username}" is already taken.`
      : `Failed: ${error.message}`,
  );
  await sql.end();
  process.exit(1);
}

await sql.end();
