/**
 * Find storage objects no database row references.
 * Dry-run by default; pass --delete to remove the reported objects.
 */
import { loadEnvFile } from "node:process";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

loadEnvFile(".env.local");

const shouldDelete = process.argv.includes("--delete");
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const storage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
).storage.from(process.env.SUPABASE_STORAGE_BUCKET);

const referencedRows = await sql.unsafe(`
  SELECT storage_key AS key FROM pages
  UNION SELECT thumbnail_storage_key FROM pages WHERE thumbnail_storage_key IS NOT NULL
  UNION SELECT original_storage_key FROM pages WHERE original_storage_key IS NOT NULL
  UNION SELECT cover_storage_key FROM books WHERE cover_storage_key IS NOT NULL
`);
const referenced = new Set(referencedRows.map((row) => row.key));

async function listObjects(prefix = "") {
  const found = [];
  let offset = 0;

  while (true) {
    const { data, error } = await storage.list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) throw error;

    for (const entry of data) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.id === null) {
        found.push(...(await listObjects(key)));
      } else {
        found.push(key);
      }
    }

    if (data.length < 100) break;
    offset += data.length;
  }

  return found;
}

try {
  const objects = await listObjects();
  const orphans = objects.filter((key) => !referenced.has(key));

  if (orphans.length === 0) {
    console.log("No orphaned storage objects found.");
  } else {
    console.log(`${orphans.length} orphaned object(s):`);
    for (const key of orphans) console.log(`  ${key}`);

    if (!shouldDelete) {
      console.log("Dry run only. Pass --delete to remove them.");
    } else {
      for (let index = 0; index < orphans.length; index += 100) {
        const { error } = await storage.remove(orphans.slice(index, index + 100));
        if (error) throw error;
      }
      console.log(`Removed ${orphans.length} orphaned object(s).`);
    }
  }
} finally {
  await sql.end();
}
