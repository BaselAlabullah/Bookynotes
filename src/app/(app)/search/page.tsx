import type { Metadata } from "next";
import Link from "next/link";

import { requireUser } from "@/features/auth/auth.session";
import { SearchForm } from "@/features/search/components/search-form";
import { SearchResults } from "@/features/search/components/search-results";
import {
  countSearchableAnnotations,
  searchAnnotations,
} from "@/features/search/search.repository";
import { searchQuerySchema } from "@/features/search/search.schema";

export const metadata: Metadata = { title: "Search · Marginalia" };

/**
 * Search across every annotation the user owns.
 *
 * The query lives in the URL, so this page is a pure function of `?q=`: the
 * same URL always shows the same results, the back button works, and a result
 * list can be sent to someone else (who will see their own library, since every
 * query is scoped by `requireUser`).
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const { q } = await searchParams;

  const parsed = searchQuerySchema.safeParse(q ?? "");
  // An absent query is the normal first visit, not an error. Only a query that
  // was typed and rejected deserves a message.
  const validationMessage =
    q && !parsed.success
      ? (parsed.error.issues[0]?.message ?? "That search is not valid.")
      : null;

  const results = parsed.success
    ? await searchAnnotations(user.id, parsed.data)
    : [];

  const total = parsed.success ? 0 : await countSearchableAnnotations(user.id);

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl">Search</h1>
        <p className="text-sm text-ink-muted">
          Your notes and every passage the model has read, across your whole
          library.
        </p>
      </div>

      <SearchForm query={parsed.success ? parsed.data : (q ?? "")} />

      {validationMessage ? (
        <p role="alert" className="text-sm text-red-600">
          {validationMessage}
        </p>
      ) : null}

      {parsed.success ? (
        results.length > 0 ? (
          <section className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              {results.length} {results.length === 1 ? "result" : "results"} for
              “{parsed.data}”
            </p>
            <SearchResults results={results} />
          </section>
        ) : (
          <p className="text-ink-muted">
            Nothing matched “{parsed.data}”. Quoted phrases are kept together,
            and a word prefixed with a minus sign is excluded.
          </p>
        )
      ) : (
        // Nothing searched yet. What to say depends on whether there is
        // anything to find — "no results" and "no annotations" are different
        // problems and deserve different next steps.
        <p className="text-ink-muted">
          {total === 0 ? (
            <>
              You have not annotated anything yet.{" "}
              <Link href="/library" className="underline">
                Start with a book
              </Link>
              .
            </>
          ) : (
            `Searching ${total} ${total === 1 ? "annotation" : "annotations"}.`
          )}
        </p>
      )}
    </main>
  );
}
