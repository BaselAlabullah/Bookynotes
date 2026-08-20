/**
 * The search box.
 *
 * A plain GET form with no `"use client"` anywhere: submitting navigates to
 * `/search?q=...`, the server component reads the query and renders the
 * results. That gets several things for free rather than by writing them —
 * shareable URLs, a working back button, and a search that functions with
 * JavaScript disabled.
 *
 * This is the opposite choice to the Open Library search in phase 4, and for a
 * stated reason: that one fires while the user types and needs cancellable
 * overlapping requests, so it had to be a route handler and client fetch. This
 * one is submit-driven, so none of that machinery earns its place.
 */
export function SearchForm({ query }: { query: string }) {
  return (
    <form action="/search" method="get" className="flex gap-2">
      <input
        type="search"
        name="q"
        defaultValue={query}
        placeholder="A phrase you remember, or a note you wrote"
        aria-label="Search your annotations"
        autoFocus
        className="flex-1 rounded-md border border-ink-muted/30 bg-transparent px-3 py-2 outline-none focus:border-accent"
      />
      <button
        type="submit"
        className="rounded-md bg-accent px-4 py-2 font-medium text-paper"
      >
        Search
      </button>
    </form>
  );
}
