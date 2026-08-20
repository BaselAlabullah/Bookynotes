# features/search

Full-text search across every annotation a user owns.

```
search.types.ts                 SearchResult, and the highlight delimiters
search.schema.ts                the query from the URL, and the page size
search.repository.ts            the ranked, joined, highlighted query
components/search-form.tsx      a plain GET form
components/search-results.tsx   the result list
components/highlighted-snippet.tsx  turns ts_headline markers into <mark>
```

Nothing here is a client component. Search is a `<form method="get">` pointing
at `/search`, so the query lives in the URL: results are shareable, the back
button works, and the whole feature functions with JavaScript disabled. That is
the opposite of the Open Library search in `features/books`, which fires while
you type and therefore needs a route handler — see DECISIONS 0044.

## Where the ranking comes from

The `search_vector` column and its GIN index have existed since phase 2. The
weights were fixed then and are visible only now:

| Weight | Field | Reasoning |
| --- | --- | --- |
| A | `user_comment` | The reader's own words rank highest. |
| B | `extracted_passage` | What the book actually says. |
| C | `extracted_context` | Surrounding material, useful but weakest. |

Measured on three annotations with the search term in a different field each:
`1.4`, `0.4`, `0.2`.

## Two things worth knowing

**This repository joins three tables**, which breaks the rule that a repository
touches only its own. Search has no table of its own, and a result is useless
without its book and page. The rule was restated rather than dropped: *reads may
cross domains, writes may not*. Nothing writes through this file, and `user_id`
is in the WHERE clause as always. See DECISIONS 0045.

**Highlights are not HTML.** `ts_headline` marks matches with control
characters, and `highlighted-snippet.tsx` splits on them to emit real `<mark>`
elements. Asking Postgres for `<mark>` directly would mean rendering a user's
note and a model's output through `dangerouslySetInnerHTML`.

`websearch_to_tsquery` parses the query, so quoted phrases, `or` and `-word` all
work — and, unlike `plain_to_tsquery`, a stray operator never raises a syntax
error.
