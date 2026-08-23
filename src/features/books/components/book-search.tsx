"use client";

import { useActionState, useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { bookSearchResponseSchema } from "@/integrations/open-library/open-library.schema";
import type { BookSearchResult } from "@/integrations/open-library/open-library.types";

import { addBookAction } from "../books.actions";
import { apiErrorSchema, emptyAddBookState } from "../books.schema";
import { BookCover } from "./book-cover";

/** Long enough that a typist does not fire a request per keystroke, short
 * enough that the results feel like they are keeping up. */
const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

export function BookSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BookSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // One action state shared by every result's form. Which book was added is
  // carried in the state itself, so there is no need for a hook per row.
  const [addState, addAction, isAdding] = useActionState(
    addBookAction,
    emptyAddBookState,
  );

  const trimmed = query.trim();
  const isQueryLongEnough = trimmed.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    // No state is cleared here. Whether results are worth showing is derived
    // below from the query itself, which keeps this effect doing exactly one
    // thing: talking to the network.
    if (!isQueryLongEnough) {
      return;
    }

    // One controller per scheduled search. The cleanup below aborts it, which
    // does two jobs: it stops the request when the query changes, and it means
    // a slow response for "du" can never arrive after "dune" and overwrite the
    // newer results.
    const controller = new AbortController();

    const timer = setTimeout(() => {
      void (async () => {
        setIsSearching(true);

        try {
          const response = await fetch(
            `/api/books/search?q=${encodeURIComponent(trimmed)}`,
            { signal: controller.signal },
          );
          const body: unknown = await response.json();

          if (!response.ok) {
            const parsedError = apiErrorSchema.safeParse(body);
            setResults([]);
            setSearchError(
              parsedError.success ? parsedError.data.error : "Search failed.",
            );
            return;
          }

          const parsed = bookSearchResponseSchema.safeParse(body);

          if (!parsed.success) {
            setResults([]);
            setSearchError("The search response could not be read.");
            return;
          }

          setResults(parsed.data.results);
          setSearchError(null);
        } catch {
          // An aborted request is the normal path, not a failure: it fires
          // every time the user types another character.
          if (!controller.signal.aborted) {
            setSearchError("Could not reach the search service.");
          }
        } finally {
          if (!controller.signal.aborted) {
            setIsSearching(false);
          }
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, isQueryLongEnough]);

  // Derived, not stored. A query that is too short simply has nothing to show,
  // which is a fact about the current query rather than a piece of state that
  // has to be kept in sync with it.
  const visibleResults = isQueryLongEnough ? results : [];
  const visibleSearchError = isQueryLongEnough ? searchError : null;

  return (
    <div className="flex flex-col gap-6">
      <label className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-[0.12em] text-ink-muted">
          Search Open Library
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Title, author, or both"
          autoFocus
          className="border-b border-rule bg-transparent px-1 py-3 text-lg outline-none focus:border-accent"
        />
      </label>

      {visibleSearchError ? (
        <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
          {visibleSearchError}
        </p>
      ) : null}

      {addState.error ? (
        <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
          {addState.error}
        </p>
      ) : null}

      {isSearching ? (
        <BookSearchSkeleton />
      ) : (
        <ul className="flex flex-col gap-4">
          {visibleResults.map((result) => (
            <li
              key={result.openLibraryId}
              className="flex items-start gap-4 border-b border-rule pb-5"
            >
              <BookCover url={result.coverUrl} title={result.title} />

              <div className="flex flex-1 flex-col gap-1">
                <h2 className="font-serif text-lg">{result.title}</h2>
                <p className="text-sm text-ink-muted">
                  {result.author ?? "Unknown author"}
                  {result.firstPublishYear ? ` - ${result.firstPublishYear}` : ""}
                </p>
                <p className="text-xs text-ink-muted">
                  {result.editionCount} edition
                  {result.editionCount === 1 ? "" : "s"}
                </p>
              </div>

              <form action={addAction}>
                {/* Hidden inputs, which means this is user input on arrival no
                    matter that we put it here. The Server Function re-validates
                    every field. */}
                <input type="hidden" name="title" value={result.title} />
                <input
                  type="hidden"
                  name="author"
                  value={result.author ?? "Unknown author"}
                />
                <input
                  type="hidden"
                  name="coverUrl"
                  value={result.coverUrl ?? ""}
                />
                <input
                  type="hidden"
                  name="openLibraryId"
                  value={result.openLibraryId}
                />
                <button
                  type="submit"
                  disabled={isAdding}
                  className="border border-accent px-3 py-1.5 text-sm text-accent disabled:opacity-50"
                >
                  Add
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {isQueryLongEnough &&
      !isSearching &&
      !visibleSearchError &&
      visibleResults.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing found for that.</p>
      ) : null}
    </div>
  );
}

function BookSearchSkeleton() {
  return (
    <div role="status" aria-label="Searching books" className="flex flex-col gap-4">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-start gap-4 border-b border-rule pb-5">
          <Skeleton className="h-[138px] w-[92px] shrink-0" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-9 w-14" />
        </div>
      ))}
    </div>
  );
}
