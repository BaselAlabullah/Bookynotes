/**
 * Generate thumbnails for pages uploaded before thumbnails existed.
 *
 * New uploads build their own (see features/pages/pages.service.ts). This is
 * for the rows already in the table, which otherwise fall back to serving the
 * full photograph forever.
 *
 * Safe to run repeatedly: it only touches rows where thumbnail_storage_key is
 * null, and it re-checks after each upload.
 *
 *   node scripts/backfill-thumbnails.mjs
 *
 * The resize settings below intentionally mirror
 * `src/features/pages/pages.thumbnail.ts`, which is the source of truth. If you
 * change them there, change them here.
 */
import { loadEnvFile } from "node:process";

import postgres from "postgres";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(".env.local");

const THUMBNAIL_WIDTH = 480;
const SIGNED_URL_TTL_SECONDS = 300;

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const storage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
).storage.from(process.env.SUPABASE_STORAGE_BUCKET);

const thumbnailKeyFor = (storageKey) =>
  `${storageKey.replace(/\.[^./]+$/, "")}.thumb.jpg`;

const pending = await sql`
  SELECT id, storage_key FROM pages
  WHERE thumbnail_storage_key IS NULL
  ORDER BY created_at`;

if (pending.length === 0) {
  console.log("Every page already has a thumbnail.");
  await sql.end();
  process.exit(0);
}

console.log(`${pending.length} page(s) without a thumbnail.`);

let done = 0;
let failed = 0;
let savedBytes = 0;

for (const page of pending) {
  try {
    const { data, error } = await storage.createSignedUrl(
      page.storage_key,
      SIGNED_URL_TTL_SECONDS,
    );

    if (error || !data) throw new Error(error?.message ?? "could not sign");

    const response = await fetch(data.signedUrl);
    if (!response.ok) throw new Error(`fetch ${response.status}`);

    const original = Buffer.from(await response.arrayBuffer());
    const thumbnail = await sharp(original)
      .rotate()
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();

    const key = thumbnailKeyFor(page.storage_key);
    const upload = await storage.upload(key, thumbnail, {
      contentType: "image/jpeg",
      upsert: true,
    });

    if (upload.error) throw new Error(upload.error.message);

    await sql`UPDATE pages SET thumbnail_storage_key = ${key} WHERE id = ${page.id}`;

    savedBytes += original.length - thumbnail.length;
    done += 1;
    process.stdout.write(
      `  ${done}/${pending.length}  ${(original.length / 1024).toFixed(0)}KB -> ${(thumbnail.length / 1024).toFixed(0)}KB\r`,
    );
  } catch (error) {
    failed += 1;
    console.log(`\n  failed for page ${page.id}: ${error.message}`);
  }
}

console.log(
  `\n${done} thumbnail(s) written, ${failed} failed. ` +
    `${(savedBytes / 1024 / 1024).toFixed(1)} MB less to download per full view.`,
);

await sql.end();
