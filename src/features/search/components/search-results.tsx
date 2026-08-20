import Link from "next/link";

import type { SearchResult } from "../search.types";
import { HighlightedSnippet } from "./highlighted-snippet";

/** Server-rendered results; the annotation id deep-link selects the matching mark. */
export function SearchResults({ results }: { results: SearchResult[] }) {
  return (
    <ol className="border-t border-rule">
      {results.map((result) => (
        <li key={result.annotationId} className="border-b border-rule">
          <Link
            href={`/books/${result.bookId}/pages/${result.pageNumber}?annotation=${result.annotationId}`}
            className="group grid gap-2 py-5 sm:grid-cols-[11rem_1fr] sm:gap-8"
          >
            <span className="flex flex-col text-xs text-ink-muted">
              <span className="font-serif text-base text-ink group-hover:text-accent">
                {result.bookTitle}
              </span>
              <span>{result.bookAuthor}</span>
              <span className="mt-1 tabular-nums">Page {result.pageNumber}</span>
            </span>

            <span className="flex max-w-[66ch] flex-col gap-2">
              {result.commentSnippet.trim() ? (
                <span className="text-sm leading-6">
                  <HighlightedSnippet text={result.commentSnippet} />
                </span>
              ) : null}

              {result.passageSnippet ? (
                <span className="font-serif text-base leading-7 text-ink-muted">
                  <HighlightedSnippet text={result.passageSnippet} />
                </span>
              ) : (
                <span className="text-xs italic text-ink-muted">
                  {result.enrichmentStatus === "failed"
                    ? "Passage extraction failed; this result comes from your note."
                    : "Passage not extracted yet; this result comes from your note."}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
