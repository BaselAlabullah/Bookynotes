# integrations/open-library

Book metadata and cover images from the Open Library search API. No API key, no
account, no rate limit worth worrying about at this scale.

```
open-library.schema.ts    zod for the raw response, and for our own result shape
open-library.types.ts     BookSearchResult (inferred from the schema) and the error type
open-library.client.ts    searchBooks(query)
```

Three things about this API shape the code:

1. **Almost every field is optional.** `author_name` and `cover_i` are missing
   from a large fraction of works. They are optional in the schema because the
   API genuinely omits them, not as defensive padding.
2. **One bad record must not fail a search.** `docs` is parsed as `unknown[]`
   and each entry is validated separately, so an unusable work costs the user
   one result rather than the whole query.
3. **It can be slow and has no SLA.** Requests carry an 8 second
   `AbortSignal.timeout()`. Without one, a hang would sit until the serverless
   function itself timed out and the user would get a blank page.

`fields=` is not an optimisation — it is the difference between a 2 KB response
and a 400 KB one, because the default includes every edition and ISBN.

The result type is inferred from its zod schema so the compile-time type and the
runtime validator cannot drift. The browser validates it too: JSON crossing a
network is `unknown` regardless of who wrote the endpoint.
