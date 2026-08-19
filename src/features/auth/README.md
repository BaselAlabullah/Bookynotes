# features/auth

Sessions and identity. The boundary where a cookie becomes a trusted `UserId`.

```
supabase-server.ts        request-scoped Supabase client bound to Next's cookies
session-cookie.ts         the extra restrictions we put on the session cookie
auth.session.ts           getCurrentUser() and requireUser()
auth.schema.ts            zod validation for the credential forms
auth.actions.ts           signUp / signIn / signOut as Server Functions
components/               the credential form and the sign-out button
```

Four rules hold here:

1. **`getUser()`, never `getSession()`.** The cookie is attacker-supplied data.
   `getSession()` decodes and believes it; `getUser()` verifies it with
   Supabase's auth server.
2. **`requireUser()` is called next to the data access it protects**, not only
   in a layout. Next's own docs warn that Server Functions are POSTs to the
   route that rendered them, so route-level protection can silently lapse.
3. **This module is the only place a `UserId` is minted.** Everything that
   queries the database demands that branded type, so no query can run without
   having asked who the caller is.
4. **`src/proxy.ts` refreshes the session; it does not authorize.**

There is no Supabase browser client anywhere in the app, which is what lets the
session cookie be httpOnly. Read `session-cookie.ts` before adding one.
