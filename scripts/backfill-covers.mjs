/**
 * Store local copies of book covers added before we kept our own.
 *
 * New books fetch their cover at add time (see features/books/books.actions.ts).
 * This is for the rows already in the table, which otherwise keep pointing at
 * Open Library's CDN — measured at 1.5 to 2.8 seconds per image.
 *
 * Safe to run repeatedly: it only touches rows where cover_storage_key is null
 * and cover_url is set.
 *
 *   npm run backfill:covers
 *
 * The resize settings mirror `src/features/books/books.cover.ts`, which is the
 * source of truth. If you change them there, change them here.
 */
import { loadEnvFile } from "node:process";

import postgres from "postgres";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(".env.local");

const COVER_WIDTH = 200;

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const storage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
).storage.from(process.env.SUPABASE_STORAGE_BUCKET);

const pending = await sql`
  SELECT id, user_id, title, cover_url FROM books
  WHERE cover_storage_key IS NULL AND cover_url IS NOT NULL
  ORDER BY created_at`;

if (pending.length === 0) {
  console.log("Every book with a cover already has a local copy.");
  await sql.end();
  process.exit(0);
}

console.log(`${pending.length} cover(s) to store.`);

let done = 0;
let failed = 0;

for (const book of pending) {
  const started = Date.now();

  try {
    const response = await fetch(book.cover_url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Marginalia/0.1 (github.com/marginalia)" },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const source = Buffer.from(await response.arrayBuffer());
    const cover = await sharp(source)
      .resize({ width: COVER_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();

    const key = `${book.user_id}/covers/${book.id}.jpg`;
    const upload = await storage.upload(key, cover, {
      contentType: "image/jpeg",
      upsert: true,
    });

    if (upload.error) throw new Error(upload.error.message);

    await sql`UPDATE books SET cover_storage_key = ${key} WHERE id = ${book.id}`;

    done += 1;
    console.log(
      `  ${book.title}: ${(source.length / 1024).toFixed(0)}KB -> ` +
        `${(cover.length / 1024).toFixed(0)}KB, fetched in ${Date.now() - started}ms`,
    );
  } catch (error) {
    failed += 1;
    console.log(`  ${book.title}: failed (${error.message})`);
  }
}

console.log(`\n${done} stored, ${failed} failed.`);
await sql.end();
