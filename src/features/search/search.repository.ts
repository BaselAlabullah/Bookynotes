import { and, desc, eq, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { UserId } from "@/db/ids";
import { annotations, books, pages } from "@/db/schema";

import { RESULTS_PER_PAGE } from "./search.schema";
import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  type SearchResult,
} from "./search.types";

/**
 * Full-text search across everything one user has annotated.
 *
 * This file breaks the rule from DECISIONS 0003 that a repository touches only
 * its own tables, and does so deliberately. Search has no table of its own: a
 * result is an annotation, plus the page it sits on, plus the book that page
 * belongs to. Fetching those in three round trips and stitching them together
 * in JavaScript would be layering dogma at the cost of the one query Postgres
 * is built to answer.
 *
 * The rule that still holds, and is the one that matters: this is a **read**.
 * Nothing writes through here, and `user_id` is in the WHERE clause exactly as
 * it is everywhere else.
 */

/**
 * `websearch_to_tsquery` rather than `plain_to_tsquery`, because readers
 * already know how search boxes work: quoted phrases stay together, `or`
 * broadens, and a leading `-` excludes. Crucially it also never throws on
 * malformed input — `plain_to_tsquery` raises a syntax error on a stray
 * operator, which would turn a typo into a 500.
 */
const buildQuery = (query: string) =>
  sql`websearch_to_tsquery('english', ${query})`;

function normalizeLooseQuery(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * `ts_headline` options.
 *
 * `MaxFragments=2` lets a long passage show two separate matching regions
 * joined by an ellipsis rather than one arbitrary window, which is usually the
 * difference between a snippet that proves the match and one that merely
 * contains it.
 */
const headlineOptions =
  `StartSel=${HIGHLIGHT_START},StopSel=${HIGHLIGHT_END},` +
  `MaxWords=32,MinWords=12,ShortWord=3,MaxFragments=2,FragmentDelimiter= … `;

export async function searchAnnotations(
  userId: UserId,
  query: string,
): Promise<SearchResult[]> {
  const looseQuery = normalizeLooseQuery(query);

  if (looseQuery.length === 0) {
    return [];
  }

  const tsQuery = buildQuery(query);
  const searchableText = sql<string>`regexp_replace(
    lower(concat_ws(' ', ${annotations.userComment}, ${annotations.extractedPassage}, ${annotations.extractedContext})),
    '[^[:alnum:]]+',
    ' ',
    'g'
  )`;
  const looseMatch = sql`${searchableText} like ${`%${looseQuery}%`}`;
  const hasLexemes = sql`numnode(${tsQuery}) > 0`;

  // Computed once and referenced twice — in the ORDER BY and in the selected
  // column — so the ranking the user sees is the ranking that sorted the rows.
  const rank = sql<number>`ts_rank_cd(${annotations.searchVector}, ${tsQuery}) + case when ${looseMatch} then 0.05 else 0 end`;

  return db
    .select({
      annotationId: annotations.id,
      pageId: annotations.pageId,
      pageNumber: pages.pageNumber,
      bookId: books.id,
      bookTitle: books.title,
      bookAuthor: books.author,
      enrichmentStatus: annotations.enrichmentStatus,
      commentSnippet: sql<string>`case when ${hasLexemes}
        then ts_headline('english', ${annotations.userComment}, ${tsQuery}, ${headlineOptions})
        else ${annotations.userComment}
      end`,
      passageSnippet: sql<
        string | null
      >`case when ${annotations.extractedPassage} is null then null
              when ${hasLexemes}
              then ts_headline('english', ${annotations.extractedPassage}, ${tsQuery}, ${headlineOptions})
              else ${annotations.extractedPassage} end`,
      rank,
    })
    .from(annotations)
    // Inner joins, not left: every annotation has a page and every page has a
    // book, enforced by foreign keys. A left join here would quietly hide a
    // broken relationship instead of making it impossible.
    .innerJoin(pages, eq(pages.id, annotations.pageId))
    .innerJoin(books, eq(books.id, pages.bookId))
    .where(
      and(
        eq(annotations.userId, userId),
        // The `@@` match is what the GIN index answers. Ranking happens
        // afterwards, on the handful of rows that matched, which is why the
        // index makes this fast and the ranking function does not undo it.
        or(sql`${annotations.searchVector} @@ ${tsQuery}`, looseMatch),
      ),
    )
    .orderBy(desc(rank), desc(annotations.createdAt))
    .limit(RESULTS_PER_PAGE);
}

/**
 * How many annotations the user could search, used to tell "no matches" apart
 * from "nothing to match yet". Those need different words on screen.
 */
export async function countSearchableAnnotations(
  userId: UserId,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(annotations)
    .where(eq(annotations.userId, userId));

  return row?.total ?? 0;
}
