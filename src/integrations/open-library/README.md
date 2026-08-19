# integrations/open-library

Book metadata and cover images from the Open Library search API. No API key,
no account, no rate limit worth worrying about at this scale.

Its untyped JSON is parsed with Zod at this boundary, so nothing downstream
deals with `unknown` shapes from a third party.

Built in phase 4.
