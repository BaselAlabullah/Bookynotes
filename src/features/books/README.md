# features/books

A book in a user's library: title, author, optional series and index, cover,
optional Open Library id.

```
books.types.ts            Book (inferred from the schema) and NewBook
books.schema.ts           zod for the search query and the add-book form
books.repository.ts       every query against the books table; userId first, always
books.actions.ts          addBookAction, a Server Function
components/               search UI, library list, cover
```

There is no `books.service.ts`. Adding a book touches only the books table, so
there is no cross-domain ownership check to orchestrate — a service here would
be a function that forwards to the repository and nothing else.

Two things worth knowing:

- **Search and add are deliberately different mechanisms.** Adding is a Server
  Function, because it is a form mutation that should work without JavaScript
  and benefits from being serialised. Search is a route handler under
  `src/app/api/books/search`, because it fires while the user types and needs
  requests to overlap and be cancellable. See DECISIONS 0020.
- **The hidden inputs on a search result are user input.** They are re-validated
  in the Server Function, including the shape of the Open Library work id.
  Nothing is trusted because the UI put it there.

`series` and `series_index` exist on the table and stay null: Open Library's
search does not reliably expose series information, and inventing it would be
worse than leaving it empty.
