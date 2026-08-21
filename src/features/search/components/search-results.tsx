import Link from "next/link";
import type { ReactNode } from "react";

import type { SearchResult } from "../search.types";
import { HighlightedSnippet } from "./highlighted-snippet";

/** Server-rendered results; the annotation id deep-link selects the matching mark. */
export function SearchResults({
  results,
  query,
}: {
  results: SearchResult[];
  query: string;
}) {
  const groups = groupResults(results);

  return (
    <div className="flex flex-col gap-7">
      {groups.map((group) => (
        <section key={group.bookId} className="border-t border-rule pt-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-serif text-xl">{group.bookTitle}</h2>
              <p className="text-sm text-ink-muted">{group.bookAuthor}</p>
            </div>
            <p className="text-xs uppercase tracking-[0.1em] text-ink-muted">
              {group.results.length}{" "}
              {group.results.length === 1 ? "match" : "matches"}
            </p>
          </div>

          <ol className="flex flex-col">
            {group.pages.map((page) => (
              <li key={`${group.bookId}-${page.pageNumber}`} className="border-t border-rule/80 py-4 first:border-t-0">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Link
                    href={`/books/${group.bookId}/pages/${page.pageNumber}`}
                    className="font-serif text-base tabular-nums text-ink hover:text-accent"
                  >
                    Page {page.pageNumber}
                  </Link>
                  <span className="text-[11px] uppercase tracking-[0.1em] text-ink-muted">
                    {page.results.length}{" "}
                    {page.results.length === 1 ? "note" : "notes"}
                  </span>
                </div>

                <ol className="flex flex-col gap-3">
                  {page.results.map((result) => (
                    <li key={result.annotationId}>
                      <SearchResultCard result={result} query={query} />
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function SearchResultCard({
  result,
  query,
}: {
  result: SearchResult;
  query: string;
}) {
  const hasComment = result.commentSnippet.trim().length > 0;
  const hasPassage = Boolean(result.passageSnippet?.trim());
  const hasContext = Boolean(result.contextSnippet?.trim());

  return (
    <Link
      href={`/books/${result.bookId}/pages/${result.pageNumber}?annotation=${result.annotationId}`}
      className="group block border-l-2 border-transparent pl-4 hover:border-accent"
    >
      <span className="mb-2 flex flex-wrap gap-1.5">
        <SearchBadge>
          {result.anchor === "text" ? "Text note" : "Image note"}
        </SearchBadge>
        <SearchBadge tone={result.enrichmentStatus === "failed" ? "danger" : "neutral"}>
          {formatStatus(result)}
        </SearchBadge>
      </span>

      <span className="flex max-w-[72ch] flex-col gap-3">
        {hasComment ? (
          <SnippetBlock label="Your note">
            <HighlightedSnippet text={result.commentSnippet} query={query} />
          </SnippetBlock>
        ) : null}

        {hasPassage ? (
          <SnippetBlock label={result.anchor === "text" ? "Selected text" : "Read passage"} serif>
            <HighlightedSnippet text={result.passageSnippet ?? ""} query={query} />
          </SnippetBlock>
        ) : null}

        {hasContext ? (
          <SnippetBlock label="Context">
            <HighlightedSnippet text={result.contextSnippet ?? ""} query={query} />
          </SnippetBlock>
        ) : null}

        {!hasPassage && !hasContext ? (
          <span className="text-xs italic text-ink-muted">
            {result.enrichmentStatus === "failed"
              ? "Passage extraction failed; this result comes from your note."
              : "Passage not extracted yet; this result comes from your note."}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function SnippetBlock({
  label,
  serif = false,
  children,
}: {
  label: string;
  serif?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="grid gap-1 sm:grid-cols-[6.5rem_1fr] sm:gap-4">
      <span className="text-[11px] uppercase tracking-[0.1em] text-ink-muted">
        {label}
      </span>
      <span
        className={
          serif
            ? "font-serif text-base leading-7 text-ink-muted group-hover:text-ink"
            : "text-sm leading-6 text-ink-muted group-hover:text-ink"
        }
      >
        {children}
      </span>
    </span>
  );
}

function SearchBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <span
      className={`border px-1.5 py-0.5 text-[11px] uppercase tracking-[0.08em] ${
        tone === "danger"
          ? "border-danger/40 text-danger"
          : "border-rule text-ink-muted"
      }`}
    >
      {children}
    </span>
  );
}

function formatStatus(result: SearchResult) {
  if (result.anchor === "text") {
    return "No model";
  }

  if (result.enrichmentStatus === "complete") {
    return "Passage ready";
  }

  if (result.enrichmentStatus === "failed") {
    return "Extraction failed";
  }

  return "Pending extraction";
}

function groupResults(results: SearchResult[]) {
  const groups: Array<{
    bookId: SearchResult["bookId"];
    bookTitle: string;
    bookAuthor: string;
    results: SearchResult[];
    pages: Array<{ pageNumber: number; results: SearchResult[] }>;
  }> = [];

  for (const result of results) {
    let group = groups.find((candidate) => candidate.bookId === result.bookId);

    if (!group) {
      group = {
        bookId: result.bookId,
        bookTitle: result.bookTitle,
        bookAuthor: result.bookAuthor,
        results: [],
        pages: [],
      };
      groups.push(group);
    }

    let page = group.pages.find(
      (candidate) => candidate.pageNumber === result.pageNumber,
    );

    if (!page) {
      page = { pageNumber: result.pageNumber, results: [] };
      group.pages.push(page);
    }

    group.results.push(result);
    page.results.push(result);
  }

  return groups;
}
