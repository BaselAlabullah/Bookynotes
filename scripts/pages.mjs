/**
 * List recent pages and whether the page-processor flattened them.
 *
 * The page view shows a flattened page and an untouched one identically — that
 * is the point — so this answers the one question you cannot ask by looking:
 * did the processor run, and did it find a page?
 *
 *   npm run pages
 */
import { loadEnvFile } from "node:process";

import postgres from "postgres";

loadEnvFile(".env.local");

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

const rows = await sql`
  SELECT b.title,
         p.page_number,
         p.image_width,
         p.image_height,
         p.original_storage_key IS NOT NULL AS flattened,
         p.thumbnail_storage_key IS NOT NULL AS has_thumbnail,
         p.created_at
  FROM pages p
  JOIN books b ON b.id = p.book_id
  ORDER BY p.created_at DESC
  LIMIT 20`;

if (rows.length === 0) {
  console.log("No pages yet.");
} else {
  console.log(`${rows.length} most recent page(s):\n`);

  for (const row of rows) {
    const size = `${row.image_width}x${row.image_height}`;
    console.log(
      `  ${row.title} p.${row.page_number}`.padEnd(38) +
        size.padEnd(12) +
        (row.flattened ? "flattened, original kept" : "stored as uploaded") +
        (row.has_thumbnail ? "" : "   [no thumbnail]"),
    );
  }

  const flattened = rows.filter((row) => row.flattened).length;
  console.log(
    `\n${flattened} of ${rows.length} went through the page-processor.`,
  );
}

await sql.end();
