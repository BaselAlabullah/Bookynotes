import Link from "next/link";

import type { SearchResult } from "../search.types";
import { HighlightedSnippet } from "./highlighted-snippet";

/**
 * The result list. A server component: it renders data the page already
 * fetched and needs no interactivity, so none of it ships as JavaScript.
 */
export function SearchResults({ results }: { results: SearchResult[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {results.map((result) => (
        <li
          key={result.annotationId}
          className="rounded-lg border border-ink-muted/15 transition-colors hover:border-accent/50"
        >
          <Link
            href={`/books/${result.bookId}/pages/${result.pageNumber}`}
            className="flex flex-col gap-2 p-4"
          >
            <span className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-muted">
              <span className="font-medium text-ink dark:text-paper">
                {result.bookTitle}
              </span>
              <span>{result.bookAuthor}</span>
              <span>· page {result.pageNumber}</span>
            </span>

            {result.commentSnippet.trim() ? (
              <span className="text-sm">
                <HighlightedSnippet text={result.commentSnippet} />
              </span>
            ) : null}

            {result.passageSnippet ? (
              <span className="border-l-2 border-accent/40 pl-3 text-sm italic text-ink-muted">
                <HighlightedSnippet text={result.passageSnippet} />
              </span>
            ) : (
              <span className="text-xs text-ink-muted">
                {result.enrichmentStatus === "failed"
                  ? "The passage could not be extracted, so only your note is searchable."
                  : "The passage has not been extracted yet, so only your note is searchable."}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
